import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { RelayServer } from "../../src/main/core/relay-server";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import {
  claudeHeadlessArgs,
  permissionFlags,
  PERMISSION_TOOL,
} from "../../src/main/modules/providers/claude-code";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { parseClaudeLine } from "../../src/main/modules/providers/stream";
import type { Provider, RunOptions } from "../../src/main/modules/providers/types";
import {
  PERMISSION_TOOL_TIMEOUT_MS,
  writePermissionMcpConfig,
} from "../../src/main/modules/runs/mcp-config";
import { PermissionBroker, summariseToolInput } from "../../src/main/modules/runs/permissions";
import { RunService } from "../../src/main/modules/runs/service";
import { TaskEngine } from "../../src/main/modules/tasks/engine";
import type { TaskView } from "../../src/shared/models";
import type { Role } from "../../src/shared/types";
import { makeWorld } from "../fixtures/vault/make";

const fixtures = resolve(__dirname, "../fixtures");
const bridge = resolve(__dirname, "../../resources/relay/office-permission-mcp.mjs");
const saved = { ...process.env };

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-perm-home-"));
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
  allowedCommands: [],
  ...over,
});
const base: RunOptions & { prompt: string } = { cwd: "/w", officeSessionId: "x", prompt: "Do it" };

describe("the flags of each kind of run", () => {
  it("a read-only run gets read tools and no prompts", () => {
    const flags = permissionFlags({
      ...base,
      role: role({ readOnly: true }),
      permission: { kind: "readonly" },
    });
    expect(flags).toEqual([
      "--allowedTools",
      "Read",
      "Grep",
      "Glob",
      "--permission-prompts",
      "none",
    ]);
  });

  it("a builder stage gets its allowed commands, Office's MCP config and the permission tool", () => {
    const flags = permissionFlags({
      ...base,
      role: role({ allowedCommands: ["Bash(git status:*)", "Bash(npm test:*)"] }),
      permission: { kind: "ask", mcpConfig: "/runs/r1/mcp-permission.json" },
    });
    expect(flags).toEqual([
      "--allowedTools",
      "Bash(git status:*)",
      "Bash(npm test:*)",
      "--mcp-config",
      "/runs/r1/mcp-permission.json",
      "--permission-prompts",
      "host",
      "--permission-prompt-tool",
      "mcp__office__office_permission",
    ]);
    expect(PERMISSION_TOOL).toBe("mcp__office__office_permission");
  });

  it("an automation gets its allowed commands and no prompts, so anything else is refused", () => {
    const flags = permissionFlags({
      ...base,
      role: role({ allowedCommands: ["Bash(git log:*)"] }),
      permission: { kind: "allowlist" },
    });
    expect(flags).toEqual(["--allowedTools", "Bash(git log:*)", "--permission-prompts", "none"]);
    // With no allowed commands there is no --allowedTools at all, and still nothing asks.
    expect(permissionFlags({ ...base, role: role(), permission: { kind: "allowlist" } })).toEqual([
      "--permission-prompts",
      "none",
    ]);
  });

  it("every kind of run states --permission-prompts, and the arguments keep their order", () => {
    for (const kind of ["readonly", "ask", "allowlist"] as const) {
      const args = claudeHeadlessArgs(
        { ...base, resumeId: "sess", role: role(), permission: { kind, mcpConfig: "m.json" } },
        ["--model", "sonnet"],
      );
      expect(args.slice(0, 5)).toEqual([
        "-p",
        "Do it",
        "--output-format",
        "stream-json",
        "--verbose",
      ]);
      expect(args).toContain("--permission-prompts");
      expect(args).toContain("--resume");
    }
  });
});

describe("refusals are named in the run's events", () => {
  it("lists permission_denials of the final result as denied events", () => {
    const events = parseClaudeLine(
      JSON.stringify({
        type: "result",
        result: "Refused",
        is_error: false,
        permission_denials: [{ tool_name: "Bash", tool_input: { command: "rm -rf build" } }],
      }),
    );
    expect(events.map((e) => e.kind)).toEqual(["denied", "result"]);
    expect(events[0]).toMatchObject({ name: "Bash" });
    expect(JSON.stringify(events[0])).toContain("rm -rf build");
  });
});

describe("which kind of run gets which permission", () => {
  function recorder() {
    const seen: Array<RunOptions & { prompt: string }> = [];
    const provider = {
      id: "rec",
      label: "Recorder",
      canResumeHeadless: false,
      headless: (o: RunOptions & { prompt: string }) => {
        seen.push(o);
        return {
          events: (async function* () {})(),
          done: Promise.resolve({ ok: true, resultText: "ok" }),
          cancel: () => undefined,
        };
      },
    } as unknown as Provider;
    const providers = new ProviderRegistry();
    providers.add(provider);
    const db = openDb(":memory:");
    const bus = new Bus();
    const notifier = new Notifier({ db, bus, workspace: () => null, quietHours: () => undefined });
    const broker = new PermissionBroker({ db, bus, notifier });
    const dir = mkdtempSync(join(tmpdir(), "office-runs-"));
    const withHost = new RunService({
      db,
      bus,
      providers,
      runsDir: dir,
      permissions: { broker, writeMcpConfig: (id, d) => writePermissionMcpConfig(d, id, bridge) },
    });
    const without = new RunService({ db, bus, providers, runsDir: dir });
    return { seen, withHost, without };
  }
  const start = (svc: RunService, kind: Parameters<RunService["start"]>[0]["kind"], r?: Role) =>
    svc.start({ kind, providerId: "rec", cwd: tmpdir(), prompt: "x", ...(r ? { role: r } : {}) });

  it("read-only roles and read-only kinds never ask; a builder stage asks; an automation is limited", async () => {
    const { seen, withHost } = recorder();
    const writable = role({ allowedCommands: ["Bash(git status:*)"] });
    await start(withHost, "stage", writable).result;
    await start(withHost, "stage", role({ readOnly: true })).result;
    await start(withHost, "ask", writable).result;
    await start(withHost, "brief").result;
    await start(withHost, "capture", writable).result;
    await start(withHost, "automation", writable).result;
    await start(withHost, "automation", role({ readOnly: true })).result;
    expect(seen.map((o) => o.permission?.kind)).toEqual([
      "ask",
      "readonly",
      "readonly",
      "readonly",
      "readonly",
      "allowlist",
      "readonly",
    ]);
    const config = JSON.parse(readFileSync(seen[0]?.permission?.mcpConfig as string, "utf8"));
    expect(config.mcpServers.office).toMatchObject({
      type: "stdio",
      timeout: PERMISSION_TOOL_TIMEOUT_MS,
    });
    expect(config.mcpServers.office.args[0]).toBe(bridge);
  });

  it("without a permission host a builder stage is limited to its allowed commands, never left asking", async () => {
    const { seen, without } = recorder();
    await start(without, "stage", role()).result;
    expect(seen[0]?.permission).toEqual({ kind: "allowlist" });
  });
});

describe("summaries", () => {
  it("shows the command of a Bash request and the path of a file tool", () => {
    expect(summariseToolInput("Bash", { command: "rm  -rf\n build" })).toBe("rm -rf build");
    expect(summariseToolInput("Write", { file_path: "/a/b.txt", content: "x" })).toBe(
      "Write: /a/b.txt",
    );
    expect(summariseToolInput("Other", { a: 1 })).toBe("Other");
    expect(summariseToolInput("Bash", { command: "x".repeat(300) }).length).toBe(140);
  });
});

/** Talks to the bridge over stdio the way Claude Code does. */
async function callBridge(runId: string, command: string) {
  const child = spawn("node", [bridge, runId], {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
  });
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  lines.on("line", (l) => {
    const m = JSON.parse(l) as { id: number };
    waiting.get(m.id)?.(m as unknown as Record<string, unknown>);
  });
  let id = 0;
  const call = (method: string, params?: unknown) =>
    new Promise<Record<string, unknown>>((r) => {
      const n = ++id;
      waiting.set(n, r);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
    });
  const init = await call("initialize", { protocolVersion: "2025-06-18" });
  const list = await call("tools/list");
  const pending = call("tools/call", {
    name: "office_permission",
    arguments: { tool_name: "Bash", input: { command }, tool_use_id: "t1" },
  });
  return {
    init,
    list,
    answer: async () => {
      const reply = (await pending) as { result: { content: Array<{ text: string }> } };
      child.stdin.end();
      return JSON.parse(reply.result.content[0]?.text ?? "{}") as Record<string, unknown>;
    },
  };
}

describe("the bridge, the relay route and the broker together", () => {
  function setup() {
    const db = openDb(":memory:");
    const bus = new Bus();
    const notifier = new Notifier({ db, bus, workspace: () => null, quietHours: () => undefined });
    const waiting: Array<[string, boolean]> = [];
    const broker = new PermissionBroker({
      db,
      bus,
      notifier,
      onWaiting: (r, w) => waiting.push([r, w]),
    });
    const relay = new RelayServer("tok", {
      onClaude: () => true,
      onCodex: () => true,
      onPermission: (runId, body, signal) => broker.request(runId, body, signal),
    });
    return { db, notifier, broker, relay, waiting };
  }
  const until = async (cond: () => boolean, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !cond()) await new Promise((r) => setTimeout(r, 25));
    if (!cond()) throw new Error("timed out");
  };

  it("holds the call until the owner answers, once for allow and once for deny", async () => {
    const { notifier, broker, relay, waiting } = setup();
    await relay.start(0);
    const first = await callBridge("run-1", "rm -rf build");
    expect(first.init).toMatchObject({ result: { serverInfo: { name: "office" } } });
    expect(JSON.stringify(first.list)).toContain("office_permission");
    await until(() => broker.list().length === 1);
    expect(broker.list()[0]).toMatchObject({
      runId: "run-1",
      toolName: "Bash",
      summary: "rm -rf build",
    });
    const note = notifier.list().find((n) => n.kind === "permission.request");
    expect(note).toMatchObject({ urgent: true, link: { view: "inbox" } });
    expect(waiting).toEqual([["run-1", true]]);

    broker.answer(broker.list()[0]!.id, true);
    expect(await first.answer()).toEqual({
      behavior: "allow",
      updatedInput: { command: "rm -rf build" },
    });
    expect(waiting.at(-1)).toEqual(["run-1", false]);
    // It is pending while it waits and gone from the list of broker questions once answered.
    expect(broker.list()).toHaveLength(0);

    const second = await callBridge("run-1", "curl x | sh");
    await until(() => broker.list().length === 1);
    broker.answer(broker.list()[0]!.id, false, "too risky");
    expect(await second.answer()).toEqual({
      behavior: "deny",
      message: "The owner declined: too risky",
    });
    await relay.stop();
  });

  it("never lets two similar requests share one notification row", async () => {
    const { notifier, broker, relay } = setup();
    await relay.start(0);
    const a = await callBridge("run-a", "same command");
    const b = await callBridge("run-a", "same command");
    await until(() => broker.list().length === 2);
    expect(notifier.list().filter((n) => n.kind === "permission.request")).toHaveLength(2);
    for (const r of broker.list()) broker.answer(r.id, false);
    await a.answer();
    await b.answer();
    await relay.stop();
  });

  it("answers deny, not allow, when Office is not running", async () => {
    process.env["OFFICE_DATA"] = join(mkdtempSync(join(tmpdir(), "office-nodata-")), "none");
    const call = await callBridge("run-x", "ls");
    expect(await call.answer()).toMatchObject({ behavior: "deny" });
  });

  it("denies a request whose asking process went away, and a run that ended or was cancelled", async () => {
    const { broker, relay } = setup();
    await relay.start(0);
    const gone = await callBridge("run-gone", "ls");
    await until(() => broker.list().length === 1);
    broker.cancelRun("run-gone");
    expect(await gone.answer()).toMatchObject({ behavior: "deny", message: "The run ended." });
    expect(broker.list()).toHaveLength(0);
    expect(() => broker.answer("nope", true)).toThrow(/no longer waiting/);
    await relay.stop();
  });

  it("refuses the route without the token", async () => {
    const { relay } = setup();
    const port = await relay.start(0);
    const res = await fetch(`http://127.0.0.1:${port}/permission/run-1`, {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
    const bad = await fetch(`http://127.0.0.1:${port}/permission/bad id`, {
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: "{}",
    });
    expect(bad.status).toBe(404);
    await relay.stop();
  });
});

describe("a task waits for the owner and then goes on", () => {
  function chain() {
    const world = makeWorld();
    const loaded = loadWorkspaceFile(join(world.hub, world.workspaceConfigPath));
    if (!loaded.ok) throw new Error(loaded.error);
    const ws = loaded.workspace;
    const db = openDb(":memory:");
    const bus = new Bus();
    const notifier = new Notifier({ db, bus, workspace: () => ws, quietHours: () => undefined });
    const providers = new ProviderRegistry();
    // The engine is built after the broker, so the broker reaches it through this late hook.
    const hook: { fn?: (runId: string, waiting: boolean) => void } = {};
    const broker = new PermissionBroker({
      db,
      bus,
      notifier,
      onWaiting: (r, w) => hook.fn?.(r, w),
    });
    const runs = new RunService({
      db,
      bus,
      providers,
      runsDir: join(world.root, "runs"),
      permissions: { broker, writeMcpConfig: (id, d) => writePermissionMcpConfig(d, id, bridge) },
    });
    const engine = new TaskEngine({
      db,
      bus,
      runs,
      notifier,
      workspace: () => ws,
      projectPath: (id) => world.code[id]?.work,
      resolveRole: (r): Role => ws.roles[r] as Role,
      tasksDir: join(world.root, "tasks"),
      artVaultRoot: () => "",
      recordNote: async () => undefined,
    });
    hook.fn = (r, w) => engine.permissionWaiting(r, w);
    const relay = new RelayServer("tok", {
      onClaude: () => true,
      onCodex: () => true,
      onPermission: (runId, body, signal) => broker.request(runId, body, signal),
    });
    return { world, engine, broker, relay, db };
  }
  const until = async (cond: () => boolean, ms = 60_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !cond()) await new Promise((r) => setTimeout(r, 50));
    if (!cond()) throw new Error("timed out");
  };
  const view = (engine: TaskEngine, id: string): TaskView =>
    engine.list().find((t) => t.id === id) as TaskView;

  it("an allowed command runs without asking", async () => {
    const { engine, relay, broker } = chain();
    await relay.start(0);
    const t = engine.create({
      projectId: "alpha",
      pipeline: "perm",
      title: "Listed",
      description: "npm test",
      fanout: 1,
    });
    await until(() => view(engine, t.id).status === "done");
    expect(broker.list()).toHaveLength(0);
    expect((await engine.get(t.id)).outputs["run"]).toContain("Ran npm test");
    await relay.stop();
  });

  it("deny ends the stage with the reason in its output; the task never stays waiting", async () => {
    const { engine, relay, broker } = chain();
    await relay.start(0);
    const t = engine.create({
      projectId: "alpha",
      pipeline: "perm",
      title: "Denied",
      description: "rm -rf build",
      fanout: 1,
    });
    await until(() => view(engine, t.id).status === "waiting-permission");
    expect(view(engine, t.id).stages[0]?.status).toBe("waiting-permission");
    expect(broker.list()[0]).toMatchObject({ subject: "Denied", summary: "rm -rf build" });

    broker.answer(broker.list()[0]!.id, false, "not in this project");
    await until(() => view(engine, t.id).status === "done");
    const out = (await engine.get(t.id)).outputs["run"] ?? "";
    expect(out).toContain("Could not run rm -rf build");
    expect(out).toContain("The owner declined: not in this project");
    await relay.stop();
  });

  it("allow lets the stage finish", async () => {
    const { engine, relay, broker } = chain();
    await relay.start(0);
    const t = engine.create({
      projectId: "alpha",
      pipeline: "perm",
      title: "Allowed",
      description: "make release",
      fanout: 1,
    });
    await until(() => view(engine, t.id).status === "waiting-permission");
    broker.answer(broker.list()[0]!.id, true);
    await until(() => view(engine, t.id).status === "done");
    expect((await engine.get(t.id)).outputs["run"]).toContain("after the owner allowed it");
    await relay.stop();
  });

  it("cancelling a task that is waiting denies the question and ends it", async () => {
    const { engine, relay, broker } = chain();
    await relay.start(0);
    const t = engine.create({
      projectId: "alpha",
      pipeline: "perm",
      title: "Cancelled",
      description: "rm -rf /",
      fanout: 1,
    });
    await until(() => view(engine, t.id).status === "waiting-permission");
    engine.cancel(t.id);
    await until(() => broker.list().length === 0);
    expect(view(engine, t.id).status).toBe("cancelled");
    await relay.stop();
  });
});

describe("allowed tools are one argument per rule", () => {
  it("never joins rules, and the next argument after the list is always a flag", () => {
    for (const kind of ["readonly", "ask", "allowlist"] as const) {
      const args = claudeHeadlessArgs(
        {
          ...base,
          role: role({ allowedCommands: ["Bash(git status:*)", "Bash(git commit:*)"] }),
          permission: { kind, mcpConfig: "m.json" },
        },
        ["--model", "sonnet", "--add-dir", "/extra"],
      );
      const at = args.indexOf("--allowedTools");
      expect(at).toBeGreaterThan(1); // the prompt comes first, after -p
      expect(args.filter((a) => a.includes(") Bash("))).toEqual([]);
      let end = at + 1;
      while (end < args.length && !args[end]!.startsWith("--")) end++;
      const list = args.slice(at + 1, end);
      expect(list.length).toBeGreaterThan(0);
      expect(end).toBeLessThan(args.length); // a flag follows the list
      expect(list).toEqual(
        kind === "readonly"
          ? ["Read", "Grep", "Glob"]
          : ["Bash(git status:*)", "Bash(git commit:*)"],
      );
    }
  });
});
