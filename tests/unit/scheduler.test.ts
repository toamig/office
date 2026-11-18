import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { Scheduler, validCron } from "../../src/main/core/scheduler";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { RunService } from "../../src/main/modules/runs/service";
import { makeWorld } from "../fixtures/vault/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-sched-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

function setup(start: Date) {
  const world = makeWorld();
  const loaded = loadWorkspaceFile(join(world.hub, world.workspaceConfigPath));
  if (!loaded.ok) throw new Error(loaded.error);
  const ws = loaded.workspace;
  ws.automations = [
    {
      id: "nightly",
      cron: "0 3 * * *",
      project: "alpha",
      role: "researcher",
      prompt: "Summarise the project",
      enabled: true,
    },
  ];
  const db = openDb(":memory:");
  const bus = new Bus();
  const notifier = new Notifier({ db, bus, workspace: () => ws, quietHours: () => undefined });
  const runs = new RunService({
    db,
    bus,
    providers: new ProviderRegistry(),
    runsDir: join(world.root, "runs"),
  });
  const clock = { now: start };
  const scheduler = new Scheduler({
    db,
    runs,
    notifier,
    workspace: () => ws,
    projectPath: (id) => world.code[id]?.work,
    resolveRole: (roleId) => {
      const role = ws.roles[roleId];
      if (!role) throw new Error(`There is no role called "${roleId}"`);
      return role;
    },
    now: () => clock.now,
  });
  const fired = (): number =>
    (
      db.prepare("SELECT COUNT(*) AS n FROM automations_log WHERE run_id IS NOT NULL").get() as {
        n: number;
      }
    ).n;
  return { ws, db, notifier, scheduler, clock, fired };
}

async function settle(
  scheduler: Scheduler,
  notifierCount: () => number,
  expected: number,
): Promise<void> {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    if (notifierCount() >= expected && scheduler["inFlight"].size === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `timed out: notifications=${notifierCount()} inFlight=${scheduler["inFlight"].size}`,
  );
}

const at = (day: number, h: number, m = 0, s = 0): Date => new Date(2026, 10, day, h, m, s);

describe("cron validation", () => {
  it("accepts real expressions and rejects nonsense", () => {
    expect(validCron("0 3 * * *")).toBe(true);
    expect(validCron("*/15 * * * *")).toBe(true);
    expect(validCron("every day")).toBe(false);
    expect(validCron("")).toBe(false);
  });
});

describe("scheduler with a fake clock", () => {
  it("fires at the slot, never twice for the same slot, and again for the next one", async () => {
    const h = setup(at(19, 2, 0));
    h.scheduler.tick(); // first sight: a baseline, not a run
    expect(h.fired()).toBe(0);

    h.clock.now = at(19, 2, 59, 59);
    h.scheduler.tick();
    expect(h.fired()).toBe(0);

    h.clock.now = at(19, 3, 0, 30);
    h.scheduler.tick();
    await settle(h.scheduler, h.fired, 1);
    expect(h.fired()).toBe(1);

    // Ticks inside the same slot do nothing.
    for (const [m, s] of [
      [0, 40],
      [1, 0],
      [30, 0],
    ] as const) {
      h.clock.now = at(19, 3, m, s);
      h.scheduler.tick();
    }
    expect(h.fired()).toBe(1);

    h.clock.now = at(20, 3, 0, 5);
    h.scheduler.tick();
    await settle(h.scheduler, h.fired, 2);
    expect(h.fired()).toBe(2);
    const first = h.notifier.list()[0];
    expect(first).toMatchObject({
      kind: "automation.done",
      projectId: "alpha",
      title: "Automation finished: nightly",
    });
    expect(first?.body).toContain("FAKE: Summarise the project");
  });

  it("catches up once for slots missed while the app was closed", async () => {
    const h = setup(at(17, 4, 0));
    h.scheduler.tick(); // seen at 17th 04:00, then the app "closes"
    h.clock.now = at(19, 9, 0); // two slots (18th and 19th 03:00) passed
    h.scheduler.tick();
    await settle(h.scheduler, h.fired, 1);
    expect(h.fired()).toBe(1);
    h.scheduler.tick();
    h.clock.now = at(19, 9, 5);
    h.scheduler.tick();
    expect(h.fired()).toBe(1);
    h.clock.now = at(20, 3, 1);
    h.scheduler.tick();
    await settle(h.scheduler, h.fired, 2);
    expect(h.fired()).toBe(2);
  });

  it("skips disabled automations and invalid cron expressions, and reports a missing project", async () => {
    const h = setup(at(19, 2, 0));
    h.ws.automations = [
      {
        id: "off",
        cron: "* * * * *",
        project: "alpha",
        role: "researcher",
        prompt: "x",
        enabled: false,
      },
      {
        id: "broken",
        cron: "not a cron",
        project: "alpha",
        role: "researcher",
        prompt: "x",
        enabled: true,
      },
      {
        id: "lost",
        cron: "* * * * *",
        project: "ghost",
        role: "researcher",
        prompt: "x",
        enabled: true,
      },
    ];
    h.scheduler.tick();
    h.clock.now = at(19, 2, 5);
    h.scheduler.tick();
    await settle(h.scheduler, () => h.notifier.list().length, 1);
    expect(h.fired()).toBe(0);
    expect(h.notifier.list()[0]).toMatchObject({ title: "Automation failed: lost" });
    expect(h.scheduler.list().map((a) => [a.id, a.valid])).toEqual([
      ["off", true],
      ["broken", false],
      ["lost", true],
    ]);
  });

  it("lists the last run and the next planned run, and runs on demand", async () => {
    const h = setup(at(19, 2, 0));
    const before = h.scheduler.list()[0];
    expect(before).toMatchObject({ lastFiredAt: null });
    expect(new Date(before?.nextRun as string).getHours()).toBe(3);
    const automation = h.ws.automations[0];
    if (!automation) throw new Error("no automation");
    await h.scheduler.fire(automation);
    expect(h.scheduler.list()[0]?.lastFiredAt).toBeTruthy();
    expect(h.notifier.list()).toHaveLength(1);
  });
});
