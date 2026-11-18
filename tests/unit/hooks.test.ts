import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml, type TomlTable } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/main/core/exec";
import { RelayServer } from "../../src/main/core/relay-server";
import {
  claudeCommand,
  findNotify,
  HooksManager,
  planClaudeInstall,
  planClaudeUninstall,
  planCodexInstall,
  planCodexUninstall,
  unifiedDiff,
} from "../../src/main/modules/setup/install-hooks";

const repo = resolve(__dirname, "../..");
const relayScript = join(repo, "resources/relay/office-relay.mjs");
const saved = { ...process.env };

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "office-hooks-"));
  cpSync(join(repo, "tests/fixtures/home"), home, { recursive: true });
  const data = join(home, "office-data");
  process.env["OFFICE_DATA"] = data;
  const paths = {
    claudeSettings: join(home, ".claude", "settings.json"),
    codexConfig: join(home, ".codex", "config.toml"),
    recordPath: join(data, "hooks-install.json"),
    relayScript,
  };
  return { home, data, paths, manager: new HooksManager(() => paths) };
}

beforeEach(() => {
  process.env["NODE_ENV"] = "test";
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("Claude Code settings", () => {
  it("adds one relay entry per event after the existing hooks and keeps everything else", () => {
    const original = readFileSync(join(repo, "tests/fixtures/home/.claude/settings.json"), "utf8");
    const next = JSON.parse(planClaudeInstall(original, relayScript)) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      model: string;
    };
    expect(next.model).toBe("opus");
    expect(Object.keys(next.hooks)).toEqual([
      "PreToolUse",
      "Stop",
      "SessionStart",
      "UserPromptSubmit",
      "Notification",
      "SessionEnd",
    ]);
    // The user's own Stop hook stays first, the relay comes after it.
    expect(next.hooks["Stop"]?.map((g) => g.hooks[0]?.command)).toEqual([
      "echo stopped",
      claudeCommand(relayScript),
    ]);
    expect(next.hooks["PreToolUse"]).toHaveLength(1);
    expect(claudeCommand("C:\\x y\\office-relay.mjs")).toBe(
      'node "C:/x y/office-relay.mjs" claude',
    );
  });

  it("is idempotent and updates the path instead of duplicating", () => {
    const once = planClaudeInstall("{}\n", "/a/office-relay.mjs");
    const twice = planClaudeInstall(once, "/b/office-relay.mjs");
    expect(twice).toContain("/b/office-relay.mjs");
    expect(twice).not.toContain("/a/office-relay.mjs");
    expect((twice.match(/office-relay\.mjs/g) ?? []).length).toBe(5);
  });

  it("uninstalls only relay entries, even after the file was edited by hand", () => {
    const original = readFileSync(join(repo, "tests/fixtures/home/.claude/settings.json"), "utf8");
    const installed = JSON.parse(planClaudeInstall(original, relayScript));
    installed.hooks.Stop.push({ hooks: [{ type: "command", command: "echo added later" }] });
    const removed = JSON.parse(planClaudeUninstall(JSON.stringify(installed, null, 2)));
    expect(Object.keys(removed.hooks)).toEqual(["PreToolUse", "Stop"]);
    expect(
      removed.hooks.Stop.map((g: { hooks: Array<{ command: string }> }) => g.hooks[0]?.command),
    ).toEqual(["echo stopped", "echo added later"]);
  });

  it("creates a settings file that did not exist, and removes it again", () => {
    const h = fakeHome();
    const paths = { ...h.paths, claudeSettings: join(h.home, "new", "settings.json") };
    const manager = new HooksManager(() => paths);
    expect(manager.status().claude).toMatchObject({ installed: false, exists: false });
    expect(manager.apply("claude", "install").backup).toBeNull();
    expect(manager.status().claude.installed).toBe(true);
    manager.apply("claude", "uninstall");
    expect(existsSync(paths.claudeSettings)).toBe(false);
  });
});

describe("Codex config", () => {
  const config = readFileSync(join(repo, "tests/fixtures/home/.codex/config.toml"), "utf8");

  it("finds the notify statement even when it is followed by a comment", () => {
    expect(findNotify(config)?.array).toEqual(["node", "C:/fake/codex-notify.js"]);
    expect(findNotify("# notify = [1]\nmodel = 'x'\n[t]\nnotify = ['no']\n")).toBeNull();
    expect(findNotify('notify = [\n  "a", # one\n  "b]",\n]\n')?.array).toEqual(["a", "b]"]);
  });

  it("wraps the existing command and changes nothing else byte for byte", () => {
    const next = planCodexInstall(config, relayScript);
    const slash = relayScript.replace(/\\/g, "/");
    expect(next).toContain(
      `notify = ["node", ${JSON.stringify(slash)}, "codex", "--chain", "node", "C:/fake/codex-notify.js"]`,
    );
    const rest = (t: string): string => t.replace(/^notify = .*$/m, "");
    expect(rest(next)).toBe(rest(config));
    expect(next).toContain("   # the desktop app's own notify command");
  });

  it("restores the original array from the --chain arguments", () => {
    const next = planCodexInstall(config, relayScript);
    expect(planCodexUninstall(next)).toBe(
      config.replace('["node", "C:/fake/codex-notify.js"]', '["node", "C:/fake/codex-notify.js"]'),
    );
    expect(planCodexUninstall(config)).toBe(config);
  });

  it("adds notify after the top-level keys when there is none, and removes the line again", () => {
    const bare = '# header\nmodel = "m"\n\n[projects.x]\ntrust = "yes"\n';
    const next = planCodexInstall(bare, relayScript);
    expect(next.split("\n")[2]).toContain("notify = [");
    expect(next.indexOf("notify")).toBeLessThan(next.indexOf("[projects.x]"));
    expect(planCodexUninstall(next)).toBe(bare);
    expect(planCodexInstall("", relayScript)).toContain("--chain");
  });

  it("keeps CRLF endings in a config that has them", () => {
    const crlf = 'model = "m"\r\nnotify = ["a"]\r\n[t]\r\nx = 1\r\n';
    const next = planCodexInstall(crlf, relayScript);
    expect(next.replace(/\r\n/g, "")).not.toContain("\n");
    expect(planCodexUninstall(next)).toBe(crlf);
    const bare = planCodexInstall('model = "m"\r\n[t]\r\n', relayScript);
    expect(bare.replace(/\r\n/g, "")).not.toContain("\n");
  });

  /** Installs, checks the result is valid TOML with exactly one notify that chains `chain`, and uninstalls. */
  function roundTrip(text: string, chain: string[]): { next: string; parsed: TomlTable } {
    const next = planCodexInstall(text, relayScript);
    const parsed = parseToml(next) as TomlTable;
    expect(parsed["notify"]).toEqual([
      "node",
      relayScript.replace(/\\/g, "/"),
      "codex",
      "--chain",
      ...chain,
    ]);
    expect(planCodexUninstall(next)).toBe(text);
    return { next, parsed };
  }

  it("handles a notify key after a byte order mark", () => {
    const { next } = roundTrip('﻿notify = ["a"]\nmodel = "m"\n', ["a"]);
    expect(next.startsWith("﻿notify")).toBe(true);
    expect(next.indexOf("﻿", 1)).toBe(-1);
    // With no notify yet, the new line goes after the mark, never before it.
    const bare = roundTrip('﻿model = "m"\n', []);
    expect(bare.next.startsWith('﻿model = "m"')).toBe(true);
    expect(roundTrip("﻿", []).next.startsWith("﻿notify")).toBe(true);
  });

  it("handles an indented or a quoted notify key without writing a second one", () => {
    roundTrip('model = "m"\n  notify = ["a"]\n', ["a"]);
    roundTrip('"notify" = ["a"]\nmodel = "m"\n', ["a"]);
    roundTrip(`'notify' = ["a", "b"]\n`, ["a", "b"]);
    roundTrip('model = "m"\n\tnotify=["a"]  # keep\n[t]\nx = 1\n', ["a"]);
    expect(findNotify('  "notify" = ["x"]')?.array).toEqual(["x"]);
  });

  it("does not take an array of arrays or a multi-line string for a table header", () => {
    const matrix = 'matrix = [\n  [1, 2],\n  [3, 4],\n]\nmodel = "m"\n[t]\nx = 1\n';
    const { next, parsed } = roundTrip(matrix, []);
    expect(parsed["matrix"]).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(next.indexOf("notify")).toBeLessThan(next.indexOf("[t]"));
    const after = 'matrix = [\n  [1, 2],\n]\nnotify = ["a"]\n';
    roundTrip(after, ["a"]);
    const doc = 'doc = """\n[not a table]\nnotify = ["fake"]\n"""\nnotify = ["a"]\n';
    roundTrip(doc, ["a"]);
    expect(findNotify('[t]\nnotify = ["a"]\n')).toBeNull();
    expect(findNotify('a = [\n  [1],\n]\n[t]\nnotify = ["a"]\n')).toBeNull();
  });
});

describe("HooksManager round trip on a fake home", () => {
  it("leaves both files byte identical after install then uninstall, with backups and a diff first", () => {
    const h = fakeHome();
    const claudeBefore = readFileSync(h.paths.claudeSettings);
    const codexBefore = readFileSync(h.paths.codexConfig);

    const preview = h.manager.preview("claude", "install");
    expect(preview.changed).toBe(true);
    expect(preview.diff).toContain("+ ");
    expect(preview.diff).toContain("office-relay.mjs");
    expect(readFileSync(h.paths.claudeSettings)).toEqual(claudeBefore);

    const a = h.manager.apply("claude", "install");
    const b = h.manager.apply("codex", "install");
    expect(a.backup && existsSync(a.backup)).toBe(true);
    expect(b.backup && existsSync(b.backup)).toBe(true);
    expect(readFileSync(a.backup as string)).toEqual(claudeBefore);
    expect(readFileSync(b.backup as string)).toEqual(codexBefore);
    expect(h.manager.status().claude.installed).toBe(true);
    expect(h.manager.status().codex.installed).toBe(true);

    expect(h.manager.preview("codex", "uninstall").changed).toBe(true);
    h.manager.apply("claude", "uninstall");
    h.manager.apply("codex", "uninstall");
    expect(readFileSync(h.paths.claudeSettings)).toEqual(claudeBefore);
    expect(readFileSync(h.paths.codexConfig)).toEqual(codexBefore);
    expect(h.manager.status().claude.installed).toBe(false);
    expect(
      readdirSync(join(h.home, ".claude")).filter((f) => f.includes("office-backup")),
    ).toHaveLength(1);
  });

  it("installing twice keeps the first original and uninstall still restores it", () => {
    const h = fakeHome();
    const before = readFileSync(h.paths.codexConfig);
    h.manager.apply("codex", "install");
    expect(h.manager.preview("codex", "install").changed).toBe(false);
    h.manager.apply("codex", "install");
    h.manager.apply("codex", "uninstall");
    expect(readFileSync(h.paths.codexConfig)).toEqual(before);
  });

  it("uninstalls structurally when the file changed after install", () => {
    const h = fakeHome();
    h.manager.apply("claude", "install");
    const edited = readFileSync(h.paths.claudeSettings, "utf8").replace(
      '"model": "opus"',
      '"model": "sonnet"',
    );
    writeFileSync(h.paths.claudeSettings, edited);
    h.manager.apply("claude", "uninstall");
    const after = JSON.parse(readFileSync(h.paths.claudeSettings, "utf8"));
    expect(after.model).toBe("sonnet");
    expect(JSON.stringify(after.hooks)).not.toContain("office-relay");
    expect(after.hooks.Stop).toHaveLength(1);
  });
});

describe("Codex uninstall after the file was edited", () => {
  it("restores the original notify and keeps the owner's edit", () => {
    const h = fakeHome();
    h.manager.apply("codex", "install");
    const installed = readFileSync(h.paths.codexConfig, "utf8");
    writeFileSync(
      h.paths.codexConfig,
      installed.replace('model = "gpt-5-codex"', 'model = "gpt-6"'),
    );
    expect(readFileSync(h.paths.codexConfig, "utf8")).toContain("gpt-6");
    h.manager.apply("codex", "uninstall");
    const after = readFileSync(h.paths.codexConfig, "utf8");
    expect(after).toContain("gpt-6");
    expect(after).not.toContain("office-relay");
    expect((parseToml(after) as TomlTable)["notify"]).toEqual(["node", "C:/fake/codex-notify.js"]);
    expect(h.manager.status().codex.installed).toBe(false);
  });

  it("works for a file with a byte order mark and an indented notify", () => {
    const h = fakeHome();
    writeFileSync(h.paths.codexConfig, '\uFEFFmodel = "m"\n  notify = ["a"]\n');
    h.manager.apply("codex", "install");
    writeFileSync(
      h.paths.codexConfig,
      `${readFileSync(h.paths.codexConfig, "utf8")}# added later\n`,
    );
    h.manager.apply("codex", "uninstall");
    const after = readFileSync(h.paths.codexConfig, "utf8");
    expect(after.startsWith("\uFEFFmodel")).toBe(true);
    expect((parseToml(after) as TomlTable)["notify"]).toEqual(["a"]);
    expect(after).toContain("# added later");
  });
});

describe("Uninstall keeps what it must", () => {
  it("writes a backup of the edited file before it edits it in place", () => {
    const h = fakeHome();
    h.manager.apply("claude", "install");
    writeFileSync(
      h.paths.claudeSettings,
      readFileSync(h.paths.claudeSettings, "utf8").replace('"model": "opus"', '"model": "sonnet"'),
    );
    const edited = readFileSync(h.paths.claudeSettings);
    const { backup } = h.manager.apply("claude", "uninstall");
    expect(backup && readFileSync(backup)).toEqual(edited);
  });

  it("restores the original bytes exactly, even when they are not valid UTF-8", () => {
    const h = fakeHome();
    const original = Buffer.concat([
      readFileSync(h.paths.codexConfig),
      Buffer.from([0x23, 0x20, 0xe9, 0xff, 0x0a]),
    ]);
    writeFileSync(h.paths.codexConfig, original);
    h.manager.apply("codex", "install");
    h.manager.apply("codex", "uninstall");
    expect(readFileSync(h.paths.codexConfig)).toEqual(original);
  });

  it("keeps an empty hooks object that the owner already had", () => {
    const text = '{\n  "model": "opus",\n  "hooks": {}\n}\n';
    expect(planClaudeUninstall(text)).toBe(text);
  });
});

describe("diff", () => {
  it("shows added and removed lines with context", () => {
    const d = unifiedDiff("a\nb\nc\nd\ne\nf\ng\nh\n", "a\nb\nc\nX\ne\nf\ng\nh\nI\n");
    expect(d).toContain("- d");
    expect(d).toContain("+ X");
    expect(d).toContain("+ I");
  });
});

describe("relay server", () => {
  function post(port: number, path: string, body: string, token?: string): Promise<number> {
    return new Promise((resolvePost) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            "content-type": "application/json",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolvePost(res.statusCode ?? 0));
        },
      );
      req.end(body);
    });
  }

  it("requires the token, validates the body, routes by path and writes relay.json", async () => {
    const h = fakeHome();
    const seen: Array<[string, unknown]> = [];
    const server = new RelayServer("secret", {
      onClaude: (p) => (seen.push(["claude", p]), p["session_id"] === "known"),
      onCodex: (p) => (seen.push(["codex", p]), true),
    });
    const port = await server.start(0);
    expect(JSON.parse(readFileSync(join(h.data, "relay.json"), "utf8"))).toEqual({
      port,
      token: "secret",
    });
    expect(await post(port, "/hook/claude", "{}")).toBe(401);
    expect(await post(port, "/hook/claude", "{}", "wrong")).toBe(401);
    expect(await post(port, "/hook/claude", "not json", "secret")).toBe(400);
    expect(await post(port, "/nope", "{}", "secret")).toBe(404);
    expect(
      await post(port, "/hook/claude", JSON.stringify({ session_id: "known" }), "secret"),
    ).toBe(200);
    expect(
      await post(port, "/hook/claude", JSON.stringify({ session_id: "other" }), "secret"),
    ).toBe(204);
    expect(await post(port, "/hook/codex", JSON.stringify({ type: "x" }), "secret")).toBe(200);
    expect(seen.map((s) => s[0])).toEqual(["claude", "claude", "codex"]);
    await server.stop();
  });

  it("falls back to a free port when the wanted one is taken", async () => {
    fakeHome();
    const first = new RelayServer("t", { onClaude: () => true, onCodex: () => true });
    const taken = await first.start(0);
    const second = new RelayServer("t", { onClaude: () => true, onCodex: () => true });
    const port = await second.start(taken);
    expect(port).not.toBe(taken);
    await first.stop();
    await second.stop();
  });
});

describe("relay script", () => {
  it("posts a Claude hook to a running server and always exits 0", async () => {
    fakeHome();
    const got: unknown[] = [];
    const server = new RelayServer("tok", {
      onClaude: (p) => (got.push(p), true),
      onCodex: () => true,
    });
    await server.start(0);
    const result = await run("node", [relayScript, "claude"], {
      input: JSON.stringify({ session_id: "s1", hook_event_name: "Stop" }),
      timeoutMs: 10_000,
    });
    expect(result.code).toBe(0);
    expect(got).toEqual([{ session_id: "s1", hook_event_name: "Stop" }]);
    await server.stop();
  });

  it("exits 0 quickly when Office is not running", async () => {
    fakeHome();
    const started = Date.now();
    const result = await run("node", [relayScript, "claude"], { input: "{}", timeoutMs: 10_000 });
    expect(result.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("codex mode forwards the event and still runs the original notify command, with or without Office", async () => {
    const h = fakeHome();
    const marker = join(h.home, "chained.txt");
    const original = [
      "node",
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(marker)}, process.argv[process.argv.length - 1])`,
    ];
    const json = JSON.stringify({ type: "agent-turn-complete", "thread-id": "T" });

    const got: unknown[] = [];
    const server = new RelayServer("tok", {
      onClaude: () => true,
      onCodex: (p) => (got.push(p), true),
    });
    await server.start(0);
    expect(
      (
        await run("node", [relayScript, "codex", "--chain", ...original, json], {
          timeoutMs: 10_000,
        })
      ).code,
    ).toBe(0);
    await until(() => existsSync(marker));
    expect(readFileSync(marker, "utf8")).toBe(json);
    expect(got).toEqual([{ type: "agent-turn-complete", "thread-id": "T" }]);
    await server.stop();

    // Office is not running: the original command still runs.
    writeFileSync(marker, "");
    await run("node", [relayScript, "codex", "--chain", ...original, json], { timeoutMs: 10_000 });
    await until(() => readFileSync(marker, "utf8") === json);
  });
});

async function until(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (cond()) return;
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
}
