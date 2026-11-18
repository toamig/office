import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { RunService } from "../../src/main/modules/runs/service";
import { captureSession, parseCaptureOutput } from "../../src/main/modules/sessions/capture";
import { SessionService } from "../../src/main/modules/sessions/service";
import type { Workspace } from "../../src/shared/types";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

const workspace: Workspace = {
  version: 1,
  vault: { kind: "none", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
  projects: [{ id: "p", name: "P", path: "p", pinned: false, archived: false }],
  roles: {},
  pipelines: {},
  notifications: { urgent: [], mutedProjects: [] },
  automations: [],
  archiveAfterDays: 7,
  briefTime: "08:00",
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "office-capture-"));
  const db = openDb(join(dir, "office.db"));
  const bus = new Bus();
  const providers = new ProviderRegistry();
  const notifier = new Notifier({
    db,
    bus,
    workspace: () => workspace,
    quietHours: () => undefined,
  });
  const sessions = new SessionService({
    db,
    bus,
    notifier,
    providers,
    workspace: () => workspace,
    projectPath: () => dir,
    logsDir: join(dir, "logs"),
  });
  const runs = new RunService({ db, bus, providers, runsDir: join(dir, "runs") });
  return { dir, db, sessions, runs, providers, runsDir: join(dir, "runs") };
}

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-capture-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

describe("parseCaptureOutput", () => {
  it("reads the items object, a bare array, fenced JSON and chatter around JSON", () => {
    const items = {
      items: [
        { text: "A", kind: "waiting" },
        { text: "B", kind: "todo" },
      ],
    };
    expect(parseCaptureOutput(JSON.stringify(items))).toEqual(items.items);
    expect(
      parseCaptureOutput("Here you go:\n```json\n" + JSON.stringify(items) + "\n```\nDone."),
    ).toEqual(items.items);
    expect(parseCaptureOutput("Sure! " + JSON.stringify(items) + " Anything else?")).toEqual(
      items.items,
    );
    expect(parseCaptureOutput('["one", "two"]')).toEqual([
      { text: "one", kind: "todo" },
      { text: "two", kind: "todo" },
    ]);
    expect(parseCaptureOutput('{"items":[{"text":"X","kind":"weird"}]}')).toEqual([
      { text: "X", kind: "todo" },
    ]);
  });

  it("returns nothing for [] or text that is not JSON", () => {
    expect(parseCaptureOutput("[]")).toEqual([]);
    expect(parseCaptureOutput('{"items":[]}')).toEqual([]);
    expect(parseCaptureOutput("Nothing is left.")).toEqual([]);
    expect(parseCaptureOutput('{"items":[{"text":"  ","kind":"todo"}]}')).toEqual([]);
  });
});

describe("captureSession", () => {
  it("closes the terminal, asks the resumed session, and returns the items the fake agent lists", async () => {
    const { sessions, runs, providers, db, runsDir } = setup();
    const s = sessions.start({ providerId: "fake", projectId: "p", title: "Worker" });
    for (let i = 0; i < 100 && !sessions.history(s.id).data.includes("ready"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const result = await captureSession({ sessions, runs, providers }, s.id);
    expect(result.supported).toBe(true);
    expect(result.items).toEqual([
      { text: "Decide the art style", kind: "waiting" },
      { text: "Write the level two script", kind: "todo" },
    ]);
    expect(sessions.get(s.id).running).toBe(false);

    const run = db
      .prepare("SELECT kind, status, project_id FROM runs WHERE id = ?")
      .get(result.runId) as {
      kind: string;
      status: string;
      project_id: string;
    };
    expect(run).toEqual({ kind: "capture", status: "done", project_id: "p" });
    expect(existsSync(join(runsDir, result.runId as string, "events.jsonl"))).toBe(true);
    expect(readFileSync(join(runsDir, result.runId as string, "result.md"), "utf8")).toContain(
      "Decide the art style",
    );
    sessions.shutdown();
  });

  it("opens empty for a tool that cannot be resumed headless", async () => {
    const { sessions, runs, providers, db } = setup();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (id, provider, project_id, cwd, status, interactive, created_at, updated_at)
       VALUES ('x1', 'codex', 'p', '/tmp', 'exited', 1, ?, ?)`,
    ).run(now, now);
    expect(await captureSession({ sessions, runs, providers }, "x1")).toEqual({
      supported: false,
      items: [],
      runId: null,
    });
  });
});

describe("auto-archive", () => {
  it("archives only captured, finished sessions that have been quiet long enough", () => {
    const { sessions, db } = setup();
    const insert = (id: string, status: string, updated: string, captured: string | null): void => {
      db.prepare(
        `INSERT INTO sessions (id, provider, project_id, cwd, status, interactive, created_at, updated_at, captured_at)
         VALUES (?, 'fake', 'p', '/tmp', ?, 1, ?, ?, ?)`,
      ).run(id, status, updated, updated, captured);
    };
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 1 * 86_400_000).toISOString();
    insert("captured-old", "exited", old, old);
    insert("uncaptured-old", "exited", old, null);
    insert("captured-recent", "exited", recent, recent);
    expect(sessions.autoArchive(7)).toBe(1);
    expect(sessions.get("captured-old").archivedAt).toBeTruthy();
    expect(sessions.get("uncaptured-old").archivedAt).toBeNull();
    expect(sessions.get("captured-recent").archivedAt).toBeNull();
    expect(
      sessions
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["captured-recent", "uncaptured-old"]);
  });
});
