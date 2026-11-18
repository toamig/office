import { cpSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import {
  BriefService,
  briefDue,
  buildBriefPrompt,
  splitBrief,
  startOfYesterday,
} from "../../src/main/modules/brief/brief";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { RunService } from "../../src/main/modules/runs/service";
import { makeWorld } from "../fixtures/vault/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-brief-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

/** Rewrites the only commit of a repo so it happened long ago. */
function backdate(repo: string): void {
  const date = "2020-01-01T00:00:00";
  execFileSync("git", ["-C", repo, "commit", "-q", "--amend", "--no-edit", "--date", date], {
    env: { ...process.env, GIT_COMMITTER_DATE: date },
    stdio: "ignore",
  });
}

function setup(now = new Date(2026, 10, 19, 9, 0)) {
  const world = makeWorld();
  const loaded = loadWorkspaceFile(join(world.hub, world.workspaceConfigPath));
  if (!loaded.ok) throw new Error(loaded.error);
  const db = openDb(":memory:");
  const bus = new Bus();
  const notifier = new Notifier({
    db,
    bus,
    workspace: () => loaded.workspace,
    quietHours: () => undefined,
  });
  const runs = new RunService({
    db,
    bus,
    providers: new ProviderRegistry(),
    runsDir: join(world.root, "runs"),
  });
  const service = new BriefService({
    db,
    runs,
    notifier,
    workspace: () => loaded.workspace,
    projectsRoot: () => world.projectsRoot,
    workspaceRoot: () => world.hub,
    now: () => now,
  });
  return { world, service, db, notifier };
}

describe("brief helpers", () => {
  it("knows when the brief is due and where yesterday starts", () => {
    expect(briefDue(new Date(2026, 10, 19, 7, 59), "08:00")).toBe(false);
    expect(briefDue(new Date(2026, 10, 19, 8, 0), "08:00")).toBe(true);
    expect(startOfYesterday(new Date(2026, 10, 19, 15, 30))).toEqual(new Date(2026, 10, 18, 0, 0));
  });

  it("builds a prompt with one section per active project and splits the answer back", () => {
    const prompt = buildBriefPrompt([
      {
        project: { id: "a", name: "Alpha", path: "a", pinned: false, archived: false },
        commits: ["fix bug"],
        notes: [],
        sessions: ["Worker finished"],
        runs: [],
      },
    ]);
    expect(prompt).toContain("### Alpha");
    expect(prompt).toContain("- commit: fix bug");
    expect(prompt).toContain("- session: Worker finished");
    const parts = splitBrief(
      "Intro\n## Alpha\n\nLine one.\n\n## Unknown\n\nignored\n## Beta\nLine two",
      ["Alpha", "Beta"],
    );
    expect([...parts.entries()]).toEqual([
      ["Alpha", "Line one."],
      ["Beta", "Line two"],
    ]);
  });
});

describe("BriefService with the fake agent", () => {
  it("lists only projects with activity and stores one brief per project", async () => {
    const { world, service, notifier } = setup();
    backdate(world.code["beta"]?.work as string);
    backdate(join(world.hub, "Beta"));
    const activities = await service.collect(startOfYesterday(new Date(2026, 10, 19)));
    expect(activities.map((a) => a.project.id)).toEqual(["alpha"]);
    expect(activities[0]?.commits).toEqual(["alpha: initial"]);
    expect(activities[0]?.notes).toEqual(["Alpha: initial"]);

    const result = await service.run();
    expect(result).toEqual({ date: "2026-11-19", count: 1 });
    const latest = service.latest();
    expect(latest.date).toBe("2026-11-19");
    expect(latest.items).toEqual([
      {
        projectId: "alpha",
        projectName: "Alpha",
        markdown: "Fake brief for Alpha: things changed.",
      },
    ]);
    expect(notifier.list().map((n) => n.kind)).toEqual(["brief.ready"]);
  });

  it("runs once a day at or after the brief time, and not before", async () => {
    const early = setup(new Date(2026, 10, 19, 7, 0));
    expect(await early.service.runIfDue()).toBe(false);

    const { service, db } = setup(new Date(2026, 10, 19, 9, 0));
    expect(await service.runIfDue()).toBe(true);
    expect(await service.runIfDue()).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE kind = 'brief'").get()).toEqual({
      n: 1,
    });
  });

  it("skips quietly when nothing happened, but still counts the day as done", async () => {
    const { world, service } = setup();
    for (const id of ["alpha", "beta"]) backdate(world.code[id]?.work as string);
    for (const f of ["Alpha", "Beta"]) backdate(join(world.hub, f));
    expect(await service.runIfDue()).toBe(true);
    expect(service.latest()).toEqual({ date: null, items: [] });
    expect(await service.runIfDue()).toBe(false);
  });
});
