import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache, resolveTool } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { getLayout, setLayout } from "../../src/main/modules/sessions/layouts";
import { SessionService } from "../../src/main/modules/sessions/service";
import {
  statusForClaudeHook,
  statusForCodexEvent,
  statusOnOutput,
  statusOnTick,
} from "../../src/main/modules/sessions/status";
import type { Workspace } from "../../src/shared/types";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

const workspace: Workspace = {
  version: 1,
  vault: { kind: "none", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
  projects: [
    { id: "p", name: "P", path: "p", pinned: false, archived: false, roles: { builder: "alt" } },
  ],
  roles: {
    builder: { provider: "fake", model: "sonnet", instructions: "Build.", readOnly: false },
    alt: { provider: "fake", model: "haiku", instructions: "Alt build.", readOnly: false },
  },
  pipelines: {},
  notifications: { urgent: ["agent.needs-you"], mutedProjects: [] },
  automations: [],
  archiveAfterDays: 7,
  briefTime: "08:00",
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "office-sess-"));
  const db = openDb(join(dir, "office.db"));
  const bus = new Bus();
  const notifier = new Notifier({
    db,
    bus,
    workspace: () => workspace,
    quietHours: () => undefined,
  });
  const service = new SessionService({
    db,
    bus,
    notifier,
    providers: new ProviderRegistry(),
    workspace: () => workspace,
    projectPath: (id) => (id === "p" ? dir : undefined),
    logsDir: join(dir, "logs"),
  });
  const statuses: string[] = [];
  bus.on("session.status", (e) => statuses.push((e.payload as { status: string }).status));
  return { dir, db, service, notifier, statuses };
}

async function until(cond: () => boolean, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
}

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-sess-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

describe("status rules", () => {
  it("maps Claude hooks and Codex events (plan 9.2, 9.3)", () => {
    expect(statusForClaudeHook("SessionStart")).toBe("idle");
    expect(statusForClaudeHook("UserPromptSubmit")).toBe("working");
    expect(statusForClaudeHook("Notification")).toBe("needs-you");
    expect(statusForClaudeHook("Stop")).toBe("idle");
    expect(statusForClaudeHook("SessionEnd")).toBe("exited");
    expect(statusForClaudeHook("Other")).toBeNull();
    expect(statusForCodexEvent("agent-turn-complete")).toBe("idle");
  });

  it("falls back to output and silence when no hook reports (plan 9.4)", () => {
    const s = { status: "starting" as const, hookSeen: false, lastOutputMs: 1000, lastWriteMs: 0 };
    expect(statusOnOutput(s, 1000)).toBe("working");
    const working = { ...s, status: "working" as const };
    expect(statusOnTick(working, 1000 + 19_999)).toBeNull();
    expect(statusOnTick(working, 1000 + 20_000)).toBe("idle");
    // Echo of the owner's own typing does not make an idle session look busy.
    const idle = { ...s, status: "idle" as const, lastWriteMs: 5000 };
    expect(statusOnOutput(idle, 5500)).toBeNull();
    expect(statusOnOutput(idle, 9000)).toBe("working");
    // Codex reports only the end of a turn: output after the owner's next prompt starts a new one.
    const codexIdle = { ...idle, hookSeen: true };
    expect(statusOnOutput({ ...codexIdle, lastWriteMs: 5000 }, 5500)).toBeNull();
    expect(statusOnOutput({ ...codexIdle, lastWriteMs: 5000 }, 9000)).toBe("working");
    // Claude Code's hooks report the prompt themselves, so output alone changes nothing.
    expect(statusOnOutput({ ...codexIdle, promptHook: true, lastWriteMs: 5000 }, 9000)).toBeNull();
    // With hooks in charge, silence never flips the status.
    expect(statusOnTick({ ...working, hookSeen: true }, 999_999)).toBeNull();
  });
});

describe("SessionService with the fake agent", () => {
  it("starts from a role with the project override, runs, and ends as exited", async () => {
    const { service, statuses, dir } = setup();
    expect(resolveTool("fake-claude")).toBeTruthy();
    const session = service.start({ roleId: "builder", projectId: "p", title: "Build it" });
    expect(session).toMatchObject({
      provider: "fake",
      status: "starting",
      projectId: "p",
      cwd: dir,
      role: "builder",
    });
    expect(session.providerSessionId).toBe(session.id);
    await until(() => service.history(session.id).data.includes("fake-claude ready"));
    await until(() => service.get(session.id).status === "working");
    service.write(session.id, "hi\r");
    await until(() => service.history(session.id).data.includes("echo: hi"));
    service.write(session.id, "quit\r");
    await until(() => service.get(session.id).status === "exited");
    expect(service.get(session.id)).toMatchObject({ running: false });
    expect(service.get(session.id).endedAt).toBeTruthy();
    expect(statuses).toContain("working");
    service.shutdown();
  });

  it("a crash is failed, a stop is exited, and a failed session raises a notification", async () => {
    const { service, notifier } = setup();
    const crashed = service.start({ providerId: "fake", projectId: "p", title: "Crashy" });
    await until(() => service.history(crashed.id).data.includes("ready"));
    service.write(crashed.id, "crash\r");
    await until(() => service.get(crashed.id).status === "failed");
    expect(notifier.list().map((n) => n.kind)).toContain("agent.failed");

    const stopped = service.start({ providerId: "fake", projectId: "p", title: "Stopped" });
    await until(() => service.history(stopped.id).data.includes("ready"));
    service.kill(stopped.id);
    await until(() => service.get(stopped.id).status === "exited");
    service.shutdown();
  });

  it("a Notification hook moves the session to needs-you and raises one urgent notification", async () => {
    const { service, notifier } = setup();
    const s = service.start({ providerId: "fake", projectId: "p", title: "Asker" });
    await until(() => service.history(s.id).data.includes("ready"));
    expect(
      service.onClaudeHook({
        session_id: s.id,
        hook_event_name: "Notification",
        message: "Need permission",
      }),
    ).toBe(true);
    expect(service.get(s.id).status).toBe("needs-you");
    const rows = notifier.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "agent.needs-you",
      urgent: true,
      body: "Need permission",
    });
    expect(service.onClaudeHook({ session_id: s.id, hook_event_name: "Stop" })).toBe(true);
    expect(service.get(s.id).status).toBe("idle");
    // Silence no longer flips the status once hooks have reported.
    expect(service.onClaudeHook({ session_id: "unknown", hook_event_name: "Stop" })).toBe(false);
    service.shutdown();
  });

  it("maps Codex notify events by thread id, then by folder", async () => {
    const { service, db, dir } = setup();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (id, provider, project_id, cwd, status, interactive, created_at, updated_at)
       VALUES ('c1', 'codex', 'p', ?, 'working', 1, ?, ?)`,
    ).run(dir, now, now);
    expect(service.onCodexEvent({ type: "agent-turn-complete", "thread-id": "T1", cwd: dir })).toBe(
      true,
    );
    expect(service.get("c1")).toMatchObject({ status: "idle", providerSessionId: "T1" });
    expect(
      service.onCodexEvent({ type: "agent-turn-complete", "thread-id": "T1", cwd: "/elsewhere" }),
    ).toBe(true);
    expect(
      service.onCodexEvent({ type: "agent-turn-complete", "thread-id": "T9", cwd: "/elsewhere" }),
    ).toBe(false);
    service.shutdown();
  });

  it("resumes a past session in the same row, and a restart marks live rows exited", async () => {
    const first = setup();
    const s = first.service.start({ providerId: "fake", projectId: "p", title: "Again" });
    await until(() => first.service.history(s.id).data.includes("ready"));
    first.service.write(s.id, "quit\r");
    await until(() => first.service.get(s.id).status === "exited");
    const resumed = first.service.resume(s.id);
    expect(resumed.id).toBe(s.id);
    await until(() => first.service.get(s.id).running);
    await until(() => first.service.history(s.id).data.includes("fake-claude ready"));
    expect(first.service.list()).toHaveLength(1);
    first.service.shutdown();
    await until(() => !first.service.get(s.id).running);

    // A new service on the same database treats leftovers as ended.
    const db = first.db;
    db.prepare("UPDATE sessions SET status = 'working' WHERE id = ?").run(s.id);
    const second = new SessionService({
      db,
      bus: new Bus(),
      notifier: first.notifier,
      providers: new ProviderRegistry(),
      workspace: () => workspace,
      projectPath: () => undefined,
      logsDir: join(first.dir, "logs2"),
    });
    expect(second.get(s.id).status).toBe("exited");
  });

  it("rejects unknown providers, missing folders and unknown roles", () => {
    const { service } = setup();
    expect(() => service.start({ providerId: "nope", projectId: "p" })).toThrow(/Unknown provider/);
    expect(() => service.start({ providerId: "fake" })).toThrow(/Pick a project/);
    expect(() => service.start({ roleId: "ghost", projectId: "p" })).toThrow(/no role/);
  });
});

describe("layouts", () => {
  it("round-trips a layout per key", () => {
    const { db } = setup();
    expect(getLayout(db, "all")).toBeNull();
    setLayout(db, "all", { open: ["a", "b"], active: "b", split: "columns", panes: ["a", "b"] });
    setLayout(db, "p", { open: [], active: null, split: "single", panes: [] });
    expect(getLayout(db, "all")).toEqual({
      open: ["a", "b"],
      active: "b",
      split: "columns",
      panes: ["a", "b"],
    });
    setLayout(db, "all", { open: ["a"], active: "a", split: "grid", panes: [] });
    expect(getLayout(db, "all")?.split).toBe("grid");
  });
});
