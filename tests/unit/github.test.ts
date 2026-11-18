import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { ProjectService } from "../../src/main/modules/git/service";
import {
  fetchOverview,
  GithubService,
  isGithubOrigin,
  parsePrs,
  parseRuns,
} from "../../src/main/modules/github/gh";
import type { Workspace } from "../../src/shared/types";
import { makeRepoPair, sh } from "../fixtures/repos/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };
const prJson = readFileSync(join(fixtures, "gh/pr-list.json"), "utf8");
const runJson = readFileSync(join(fixtures, "gh/run-list.json"), "utf8");

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_GH"] = join(fixtures, "bin/fake-gh.mjs");
  process.env["FAKE_GH_PRS"] = join(fixtures, "gh/pr-list.json");
  process.env["FAKE_GH_RUNS"] = join(fixtures, "gh/run-list.json");
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

describe("parsing captured gh JSON", () => {
  it("reads pull requests, treating an empty review decision as none", () => {
    const prs = parsePrs(prJson);
    expect(prs.map((p) => [p.number, p.reviewDecision])).toEqual([
      [12, "REVIEW_REQUIRED"],
      [9, "APPROVED"],
      [7, null],
    ]);
    expect(prs[0]).toMatchObject({
      title: "Add the sheep counter",
      headRefName: "feature/sheep",
      state: "OPEN",
    });
  });

  it("reads CI runs, treating an empty conclusion as none", () => {
    const runs = parseRuns(runJson);
    expect(runs.map((r) => [r.name, r.status, r.conclusion])).toEqual([
      ["CI", "completed", "failure"],
      ["CI", "completed", "success"],
      ["Deploy", "in_progress", null],
    ]);
  });

  it("returns nothing for output that is not the expected JSON", () => {
    expect(parsePrs("not json")).toEqual([]);
    expect(parsePrs('{"a":1}')).toEqual([]);
    expect(parseRuns("")).toEqual([]);
  });
});

describe("origin check", () => {
  it("recognises GitHub origins in every URL form and nothing else", () => {
    for (const url of [
      "https://github.com/o/r.git",
      "git@github.com:o/r.git",
      "ssh://git@github.com/o/r",
      "https://user@github.com/o/r",
    ]) {
      expect(isGithubOrigin(url)).toBe(true);
    }
    for (const url of [
      "https://gitlab.com/o/r",
      "C:/local/bare.git",
      "/srv/git/r.git",
      "https://notgithub.com/o/r",
      null,
    ]) {
      expect(isGithubOrigin(url)).toBe(false);
    }
  });
});

describe("overview through the fake gh", () => {
  it("skips repos that are not on GitHub without calling gh", async () => {
    expect(await fetchOverview("/x", "C:/local/bare.git")).toEqual({
      isGithub: false,
      prs: [],
      runs: [],
    });
  });

  it("lists PRs and runs for a GitHub repo, and reports a gh failure as text", async () => {
    const pair = makeRepoPair();
    const ok = await fetchOverview(pair.work, "git@github.com:fixture-owner/alpha.git");
    expect(ok.isGithub).toBe(true);
    expect(ok.prs).toHaveLength(3);
    expect(ok.runs).toHaveLength(3);
    expect(ok.error).toBeUndefined();

    process.env["OFFICE_BIN_GH"] = join(fixtures, "bin/does-not-exist.mjs");
    clearToolCache();
    const broken = await fetchOverview(pair.work, "git@github.com:fixture-owner/alpha.git");
    expect(broken.error).toBeTruthy();
    expect(broken.prs).toEqual([]);
  });
});

describe("polling", () => {
  it("raises ci.failed once per failing run and pr.review-requested once per PR, only for GitHub repos", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "remote", "set-url", "origin", "git@github.com:fixture-owner/alpha.git");
    const local = makeRepoPair();
    const ws: Workspace = {
      version: 1,
      vault: { kind: "none", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
      projects: [
        { id: "alpha", name: "Alpha", path: pair.work, pinned: false, archived: false },
        { id: "local", name: "Local", path: local.work, pinned: false, archived: false },
      ],
      roles: {},
      pipelines: {},
      notifications: { urgent: ["ci.failed"], mutedProjects: [] },
      automations: [],
      archiveAfterDays: 7,
      briefTime: "08:00",
    };
    const db = openDb(":memory:");
    const bus = new Bus();
    const notifier = new Notifier({ db, bus, workspace: () => ws, quietHours: () => undefined });
    const projects = new ProjectService({
      bus,
      projects: () => ws.projects,
      projectsRoot: () => pair.root,
    });
    await projects.refreshAll();
    const github = new GithubService({ projects, notifier });

    await github.poll();
    await github.poll();
    const rows = notifier.list();
    expect(rows.map((n) => [n.kind, n.projectId]).sort()).toEqual([
      ["ci.failed", "alpha"],
      ["pr.review-requested", "alpha"],
      ["pr.review-requested", "alpha"],
      ["pr.review-requested", "alpha"],
    ]);
    expect(rows.find((n) => n.kind === "ci.failed")).toMatchObject({
      urgent: true,
      title: "CI failed in Alpha",
      body: "CI on main",
    });
    expect(rows.find((n) => n.kind === "ci.failed")?.link).toEqual({
      view: "git",
      params: { project: "alpha", tab: "prs" },
    });
  });
});
