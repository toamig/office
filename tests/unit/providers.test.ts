import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearToolCache } from "../../src/main/core/exec";
import { ClaudeCodeProvider } from "../../src/main/modules/providers/claude-code";
import {
  CodexProvider,
  codexHeadlessArgs,
  knownCodexModels,
  rememberCodexModel,
} from "../../src/main/modules/providers/codex";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { parseClaudeLine, parseCodexLine } from "../../src/main/modules/providers/stream";
import type { AgentEvent } from "../../src/main/modules/providers/types";
import type { Role } from "../../src/shared/types";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

const events = (file: string, parse: (l: string) => AgentEvent[]): AgentEvent[] =>
  readFileSync(join(fixtures, "streams", file), "utf8")
    .split("\n")
    .flatMap(parse);

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  process.env["OFFICE_BIN_CODEX"] = join(fixtures, "bin/fake-codex.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-prov-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
  process.env["OFFICE_DATA"] = join(home, "office-data");
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

const role = (over: Partial<Role> = {}): Role => ({
  provider: "claude-code",
  instructions: "",
  readOnly: false,
  ...over,
});

describe("stream parsers", () => {
  it("parses a claude stream-json run into session, text, tool and result events", () => {
    const parsed = events("claude-success.jsonl", parseClaudeLine);
    expect(parsed.map((e) => e.kind)).toEqual([
      "session",
      "text",
      "tool",
      "text",
      "session",
      "result",
    ]);
    expect(parsed[0]).toEqual({
      kind: "session",
      providerSessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(parsed[2]).toMatchObject({ kind: "tool", name: "Read" });
    expect(parsed.at(-1)).toEqual({ kind: "result", text: "All done.", ok: true });
  });

  it("marks a claude error result as not ok", () => {
    const parsed = events("claude-error.jsonl", parseClaudeLine);
    expect(parsed.at(-1)).toEqual({ kind: "result", text: "Credit balance is too low", ok: false });
  });

  it("parses codex --json item events", () => {
    const parsed = events("codex-success.jsonl", parseCodexLine);
    expect(parsed).toEqual([
      { kind: "session", providerSessionId: "019aaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      { kind: "tool", name: "command_execution", summary: "git status" },
      { kind: "text", text: "Review done: no problems." },
    ]);
  });

  it("parses codex failures and the older msg-based shape", () => {
    expect(
      events("codex-failed.jsonl", parseCodexLine).filter((e) => e.kind === "error"),
    ).toHaveLength(2);
    expect(events("codex-legacy.jsonl", parseCodexLine)).toEqual([
      { kind: "text", text: "Legacy shape works." },
    ]);
  });

  it("ignores lines that are not JSON", () => {
    expect(parseClaudeLine("not json")).toEqual([]);
    expect(parseCodexLine("")).toEqual([]);
  });
});

describe("Claude Code provider commands", () => {
  const p = new ClaudeCodeProvider({ id: "fake", bin: "fake-claude" });

  it("starts an interactive session with the Office id and the role flags", () => {
    const spec = p.interactiveCommand({
      cwd: "/work",
      officeSessionId: "abc",
      addDirs: ["/more"],
      role: role({
        model: "opus",
        effort: "high",
        permissionMode: "plan",
        instructions: "Plan only.",
      }),
    });
    const text = spec.args.join(" ");
    expect(text).toContain("--session-id abc");
    expect(text).toContain("--model opus");
    expect(text).toContain("--effort high");
    expect(text).toContain("--permission-mode plan");
    expect(text).toContain("--append-system-prompt Plan only.");
    expect(text).toContain("--add-dir /more");
  });

  it("builds a resume command", () => {
    expect(p.resumeCommand("sess-1", { cwd: "/w", officeSessionId: "x" }).args.slice(-2)).toEqual([
      "--resume",
      "sess-1",
    ]);
  });
});

describe("headless runs against the fake CLIs", () => {
  it("runs a claude-style headless task and returns the result and session id", async () => {
    const p = new ClaudeCodeProvider({ id: "fake", bin: "fake-claude" });
    const run = p.headless({
      cwd: tmpdir(),
      officeSessionId: "s1",
      prompt: "say hello",
      role: role({ model: "haiku", readOnly: true }),
    });
    const seen: string[] = [];
    for await (const e of run.events) seen.push(e.kind);
    const done = await run.done;
    expect(done).toMatchObject({ ok: true, resultText: "FAKE: say hello" });
    expect(done.providerSessionId).toBeTruthy();
    expect(seen).toContain("text");
    expect(seen.at(-1)).toBe("result");
  });

  it("reports a failed claude run", async () => {
    const p = new ClaudeCodeProvider({ id: "fake", bin: "fake-claude" });
    const done = await p.headless({ cwd: tmpdir(), officeSessionId: "s2", prompt: "FAIL_RUN" })
      .done;
    expect(done.ok).toBe(false);
    expect(done.error).toContain("told to fail");
  });

  it("runs codex exec --json and reads the -o result file", async () => {
    const p = new CodexProvider();
    const runDir = mkdtempSync(join(tmpdir(), "office-codex-run-"));
    const run = p.headless({
      cwd: tmpdir(),
      officeSessionId: "s3",
      prompt: "Review it",
      runDir,
      role: role({ provider: "codex", readOnly: true }),
    });
    const done = await run.done;
    expect(done.ok).toBe(true);
    expect(done.resultText).toContain("FAKE CODEX: Review it");
    expect(done.providerSessionId).toBe("019fakefake-0000-4000-8000-000000000042");
    expect(readFileSync(join(runDir, "result.md"), "utf8")).toContain("FAKE CODEX");
  });

  it("can cancel a run", async () => {
    process.env["FAKE_DELAY_MS"] = "20000";
    const p = new ClaudeCodeProvider({ id: "fake", bin: "fake-claude" });
    const run = p.headless({ cwd: tmpdir(), officeSessionId: "s4", prompt: "slow" });
    setTimeout(() => run.cancel(), 400);
    const done = await run.done;
    expect(done.ok).toBe(false);
    expect(done.error).toBe("cancelled");
  });
});

describe("codex exec arguments", () => {
  const base = { cwd: "/w", officeSessionId: "x", prompt: "Do it" };

  it("gives a writable role the workspace-write sandbox, effort and its instructions", () => {
    const args = codexHeadlessArgs(
      {
        ...base,
        role: role({
          provider: "codex",
          model: "m1",
          effort: "high",
          instructions: "Produce the art.",
        }),
      },
      "/r/result.md",
    );
    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(args).toContain("workspace-write");
    expect(args[args.indexOf("-s") + 1]).toBe("workspace-write");
    expect(args[args.indexOf("-c") + 1]).toBe('model_reasoning_effort="high"');
    expect(args[args.indexOf("-m") + 1]).toBe("m1");
    expect(args.at(-1)).toBe("Produce the art.\n\nDo it");
  });

  it("keeps a read-only role read-only, and maps max effort to xhigh", () => {
    const args = codexHeadlessArgs(
      { ...base, role: role({ provider: "codex", readOnly: true, effort: "max" }) },
      "/r/result.md",
    );
    expect(args[args.indexOf("-s") + 1]).toBe("read-only");
    expect(args).toContain('model_reasoning_effort="xhigh"');
    expect(args.at(-1)).toBe("Do it");
  });

  it("does not widen the sandbox of a run with no role", () => {
    const args = codexHeadlessArgs(base, "/r/result.md");
    expect(args).not.toContain("-s");
    expect(args).not.toContain("-c");
  });

  it("uses only flags that `codex exec resume` accepts", () => {
    const args = codexHeadlessArgs(
      {
        ...base,
        resumeId: "thread-1",
        role: role({ provider: "codex", effort: "low", instructions: "Hi." }),
      },
      "/r/result.md",
    );
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "--json"]);
    expect(args).not.toContain("-C");
    expect(args).not.toContain("-s");
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args.slice(-2)).toEqual(["thread-1", "Hi.\n\nDo it"]);
  });
});

describe("Codex provider", () => {
  it("lists the configured model first, then models the owner typed", async () => {
    const p = new CodexProvider();
    expect(await p.models()).toEqual(["gpt-5-codex"]);
    rememberCodexModel("gpt-6-test");
    rememberCodexModel("gpt-6-test");
    expect(knownCodexModels()).toEqual(["gpt-5-codex", "gpt-6-test"]);
  });

  it("builds interactive and resume commands", () => {
    const p = new CodexProvider();
    const spec = p.interactiveCommand({
      cwd: "/w",
      officeSessionId: "x",
      role: role({ provider: "codex", model: "m1" }),
    });
    expect(spec.args.slice(-4)).toEqual(["-m", "m1", "-C", "/w"]);
    expect(p.resumeCommand("", { cwd: "/w", officeSessionId: "x" }).args.slice(-2)).toEqual([
      "resume",
      "--last",
    ]);
    expect(p.resumeCommand("t1", { cwd: "/w", officeSessionId: "x" }).args.slice(-2)).toEqual([
      "resume",
      "t1",
    ]);
  });

  it("detects the config problem through the provider", async () => {
    const d = await new CodexProvider().detect();
    expect(d.installed).toBe(true);
    expect(d.problem).toContain("older than your config");
  });
});

describe("registry", () => {
  it("knows claude-code and codex, and the fake provider when its binary is configured", () => {
    const reg = new ProviderRegistry();
    expect(
      reg
        .all()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["claude-code", "codex", "fake"]);
    delete process.env["OFFICE_BIN_FAKE_CLAUDE"];
    clearToolCache();
    expect(
      new ProviderRegistry()
        .all()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["claude-code", "codex"]);
  });
});
