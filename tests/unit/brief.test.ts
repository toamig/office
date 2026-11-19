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
  BRIEF_MAX_CHARS,
  BRIEF_MAX_LINES,
  BRIEF_MODEL,
  BRIEF_TOOLS,
  buildBriefPrompt,
  linkForLine,
  parseBriefLines,
  plainBrief,
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

function setup(now = new Date(2026, 10, 19, 23, 59)) {
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

  it("builds a prompt with the facts per project and the format of three to five plain lines", () => {
    const prompt = buildBriefPrompt(
      [
        {
          project: { id: "a", name: "Alpha", path: "a", pinned: false, archived: false },
          commits: ["fix bug"],
          notes: [],
          sessions: ["Worker finished"],
          runs: [],
        },
      ],
      ["Approve plan of Feature"],
    );
    expect(prompt).toContain("three to five plain lines");
    expect(prompt).toContain(`at most ${BRIEF_MAX_CHARS} characters`);
    expect(prompt).toContain("### Alpha");
    expect(prompt).toContain("- commit: fix bug");
    expect(prompt).toContain("- session: Worker finished");
    expect(prompt).toContain("### Needs the owner now\n- Approve plan of Feature");
    // The run reads nothing itself: every fact is here.
    expect(prompt).toContain("do not read anything else");
    expect(BRIEF_TOOLS).toBe("Read,Grep,Glob");
    expect(BRIEF_MODEL).toBe("haiku");
  });

  it("keeps at most five lines, each short, without bullets or markdown", () => {
    const answer = [
      "## A heading that is not a line",
      "- **Alpha** changed: `3` commits landed.",
      "* Second line",
      "3. Third line",
      "- Fourth line",
      "- Fifth line",
      "- Sixth line is dropped",
      "",
      `- ${"x".repeat(300)}`,
    ].join("\n");
    const lines = parseBriefLines(answer);
    expect(lines).toHaveLength(BRIEF_MAX_LINES);
    expect(lines[0]).toBe("Alpha changed: 3 commits landed.");
    expect(lines.slice(1, 5)).toEqual(["Second line", "Third line", "Fourth line", "Fifth line"]);
    expect(parseBriefLines(`- ${"x".repeat(300)}`)[0]).toHaveLength(BRIEF_MAX_CHARS);
    expect(parseBriefLines("")).toEqual([]);
  });

  it("points each line at the place it is about, and falls back to plain lines from the facts", () => {
    const projects = [{ id: "alpha", name: "Alpha" }];
    expect(linkForLine("Alpha changed: new commits.", projects)).toEqual({
      view: "project",
      params: { id: "alpha" },
    });
    expect(linkForLine("Two things need you.", projects)).toEqual({ view: "inbox" });
    expect(linkForLine("Worth a look at the weather.", projects)).toEqual({ view: "home" });
    expect(plainBrief([], [])).toEqual([
      "Nothing changed since you last looked.",
      "Nothing needs you.",
    ]);
    expect(plainBrief([], ["a", "b"])[1]).toBe("2 things need you.");
  });
});

describe("BriefService with the fake agent", () => {
  it("collects only projects with activity, writes the lines, and keeps the facts for Show details", async () => {
    const { world, service, notifier } = setup();
    backdate(world.code["beta"]?.work as string);
    backdate(join(world.hub, "Beta"));
    const activities = await service.collect(startOfYesterday(new Date(2026, 10, 19)));
    expect(activities.map((a) => a.project.id)).toEqual(["alpha"]);
    expect(activities[0]?.commits).toEqual(["alpha: initial"]);
    expect(activities[0]?.notes).toEqual(["Alpha: initial"]);

    service.needsYou = () => ["Approve plan of Feature"];
    const result = await service.run();
    expect(result).toEqual({ date: "2026-11-19", count: 1 });
    const latest = service.latest();
    expect(latest.date).toBe("2026-11-19");
    // Three to five plain lines, each leading somewhere.
    expect(latest.lines.length).toBeGreaterThanOrEqual(3);
    expect(latest.lines.length).toBeLessThanOrEqual(BRIEF_MAX_LINES);
    expect(latest.lines[0]).toEqual({
      text: "Alpha changed: new commits and notes.",
      link: { view: "project", params: { id: "alpha" } },
    });
    expect(latest.lines[1]?.link).toEqual({ view: "inbox" });
    // The facts behind the lines, per project.
    expect(latest.items).toEqual([
      {
        projectId: "alpha",
        projectName: "Alpha",
        markdown: "- alpha: initial\n- brain: Alpha: initial",
      },
    ]);
    // A brief is a result, not an alert.
    expect(notifier.list()).toEqual([]);
  });

  it("says so in one line when nothing changed and nothing needs the owner, without asking a model", async () => {
    const { world, service } = setup();
    backdate(world.code["alpha"]?.work as string);
    backdate(world.code["beta"]?.work as string);
    backdate(join(world.hub, "Alpha"));
    backdate(join(world.hub, "Beta"));
    await service.run();
    expect(service.latest().lines.map((l) => l.text)).toEqual([
      "Nothing changed since you last looked, and nothing needs you.",
    ]);
  });

  it("runs once a day at or after the brief time, and not before", async () => {
    const early = setup(new Date(2026, 10, 19, 7, 0));
    expect(await early.service.runIfDue()).toBe(false);

    const { service, db } = setup(new Date(2026, 10, 19, 23, 59));
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
    expect(service.latest()).toMatchObject({
      lines: [{ text: "Nothing changed since you last looked, and nothing needs you." }],
      items: [],
    });
    expect(await service.runIfDue()).toBe(false);
  });
});
