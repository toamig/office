import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { run } from "../../src/main/core/exec";
import { FixService, type FixDeps } from "../../src/main/modules/pending/fix";
import {
  buildFixBrief,
  filesFromText,
  fixTitle,
  runIdOf,
  trimFailedLog,
} from "../../src/main/modules/pending/fix-brief";
import { fixKeyOf } from "../../src/shared/fix";
import type { PendingItem, SessionRow } from "../../src/shared/models";

const FAKE_GH = join(__dirname, "../fixtures/bin/fake-gh.mjs");

/** A failed CI log as `gh run view --log-failed` prints it: job, step and a time before each line. */
const FAILED_LOG = [
  "build\tInstall\t2026-01-01T10:00:00.1Z npm ci finished",
  "build\tTest\t2026-01-01T10:01:00.1Z > vitest run",
  "build\tTest\t2026-01-01T10:01:01.1Z FAIL tests/unit/sheep.test.ts > counts the flock",
  "build\tTest\t2026-01-01T10:01:01.2Z AssertionError: expected 3 to be 4",
  "build\tTest\t2026-01-01T10:01:01.3Z  at src/game/flock.ts:41:9",
  "build\tTest\t2026-01-01T10:01:02.0Z Process completed with exit code 1.",
].join("\n");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "office-fix-"));
  const project = join(root, "alpha");
  const hub = join(root, "hub");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(hub, "Alpha"), { recursive: true });
  const logFile = join(root, "failed.log");
  writeFileSync(logFile, FAILED_LOG);
  const started: Array<{ providerId: string; cwd: string; title: string; prompt: string }> = [];
  let items: PendingItem[] = [];
  const sessions = new Map<string, SessionRow>();
  const deps: FixDeps = {
    db: openDb(":memory:"),
    bus: new Bus(),
    findPending: (key) => items.find((i) => i.key === key),
    failedRun: () => ({
      name: "CI",
      status: "completed",
      conclusion: "failure",
      headBranch: "main",
      url: "https://github.com/fixture-owner/alpha/actions/runs/101",
    }),
    projectDir: (id) => (id === "alpha" ? project : undefined),
    projectName: (id) => (id === "alpha" ? "Alpha" : id),
    workspaceRoot: () => hub,
    session: (id) => sessions.get(id),
    sessionTail: () => "Error: the builder could not compile src/game/flock.ts",
    task: () => ({
      title: "Add the counter",
      stage: "build",
      error: "The builder exited with code 2",
      output: "tsc: src/game/flock.ts(41,9): error TS2322",
      dir: project,
    }),
    // gh is the fake one, reading the failed log; git answers the conflicted files.
    exec: (cmd, args, cwd) =>
      cmd === "gh"
        ? run(process.execPath, [FAKE_GH, ...args], {
            cwd,
            env: { ...process.env, FAKE_GH_LOG_FAILED: logFile, FAKE_GH_REMOTES: join(root, "r") },
          })
        : Promise.resolve({ code: 0, stdout: "src/a.ts\nsrc/b.ts\n", stderr: "" }),
    startSession: (input) => {
      started.push(input);
      const row = {
        id: `s${started.length}`,
        title: input.title,
        archivedAt: null,
        cwd: input.cwd,
      } as SessionRow;
      sessions.set(row.id, row);
      return row;
    },
  };
  return {
    service: new FixService(deps),
    deps,
    started,
    project,
    hub,
    sessions,
    setItems: (next: PendingItem[]) => (items = next),
  };
}

const item = (over: Partial<PendingItem>): PendingItem => ({
  key: "x",
  kind: "ci-failed",
  severity: "danger",
  projectId: "alpha",
  title: "Checks failed in Alpha",
  detail: "CI on main",
  link: { view: "git" },
  fingerprint: "f",
  ...over,
});

describe("the first message of a Fix session", () => {
  it("for failed CI holds the failing step from the log, the files, and what done means", async () => {
    const f = fixture();
    f.setItems([item({ key: "ci:alpha" })]);
    const plan = await f.service.plan({ type: "pending", key: "ci:alpha" });
    expect(plan.title).toBe("Fix: CI failed in Alpha");
    expect(plan.folder).toBe(f.project);
    expect(plan.projectId).toBe("alpha");
    // Only the failing step, without the install step before it or the time prefixes.
    expect(plan.brief).toContain(
      "What failed: CI failed in Alpha: CI on main, in the step build / Test",
    );
    expect(plan.brief).toContain("AssertionError: expected 3 to be 4");
    expect(plan.brief).toContain("FAIL tests/unit/sheep.test.ts");
    expect(plan.brief).not.toContain("npm ci finished");
    expect(plan.brief).not.toContain("2026-01-01T10");
    expect(plan.brief).toContain("- tests/unit/sheep.test.ts");
    expect(plan.brief).toContain("- src/game/flock.ts");
    expect(plan.brief).toContain("Done means: CI is green on main.");
    expect(plan.brief).toContain("https://github.com/fixture-owner/alpha/actions/runs/101");
  });

  it("for a conflict lists the conflicted files and says the conflict must be committed", async () => {
    const f = fixture();
    f.setItems([
      item({
        key: "conflict:alpha",
        kind: "conflict",
        title: "Merge conflict in Alpha",
        detail: "2 files to resolve",
      }),
    ]);
    const plan = await f.service.plan({ type: "pending", key: "conflict:alpha" });
    expect(plan.title).toBe("Fix: merge conflict in Alpha");
    expect(plan.folder).toBe(f.project);
    expect(plan.brief).toContain("Merge conflict in Alpha");
    expect(plan.brief).toContain("- src/a.ts");
    expect(plan.brief).toContain("- src/b.ts");
    expect(plan.brief).toContain("Done means: the conflict is resolved and committed");
  });

  it("for a failed push holds the reason and asks for the branch to be pushed", async () => {
    const f = fixture();
    f.setItems([
      item({
        key: "push-failed:alpha",
        kind: "push-failed",
        title: "Push failed in Alpha",
        detail: "remote: Permission to fixture-owner/alpha denied",
      }),
    ]);
    const plan = await f.service.plan({ type: "pending", key: "push-failed:alpha" });
    expect(plan.brief).toContain("Push failed in Alpha");
    expect(plan.brief).toContain("Permission to fixture-owner/alpha denied");
    expect(plan.brief).toContain("Done means: the branch is pushed");
  });

  it("for a failed run (session and task) holds the output the run ended with", async () => {
    const f = fixture();
    f.sessions.set("s9", {
      id: "s9",
      title: "Builder",
      cwd: f.project,
      branch: "office/x",
      archivedAt: null,
    } as SessionRow);
    f.setItems([
      item({ key: "session:s9", kind: "agent-failed", title: "Builder failed" }),
      item({ key: "task:t1", kind: "task-failed", title: '"Add the counter" failed' }),
    ]);
    const session = await f.service.plan({ type: "pending", key: "session:s9" });
    expect(session.folder).toBe(f.project);
    expect(session.brief).toContain('The session "Builder" failed');
    expect(session.brief).toContain("the builder could not compile src/game/flock.ts");
    expect(session.brief).toContain("office/x");
    const task = await f.service.plan({ type: "pending", key: "task:t1" });
    expect(task.brief).toContain('The task "Add the counter" failed in the stage build');
    expect(task.brief).toContain("The builder exited with code 2");
    expect(task.brief).toContain("- src/game/flock.ts");
  });

  it("for a brain check error holds the message, the file and the folder it lives in", async () => {
    const f = fixture();
    const plan = await f.service.plan({
      type: "validate",
      message: "Alpha/OpenItems.md: broken link [[Alpha/Missing]]",
      file: "Alpha/OpenItems.md",
      repo: "Alpha",
    });
    expect(plan.title).toBe("Fix: Alpha/OpenItems.md: broken link Alpha/Missing");
    expect(plan.folder).toBe(join(f.hub, "Alpha"));
    expect(plan.projectId).toBeUndefined();
    expect(plan.brief).toContain("broken link [[Alpha/Missing]]");
    expect(plan.brief).toContain("- Alpha/OpenItems.md");
    expect(plan.brief).toContain("node Common/tools/brain.mjs validate");
  });

  it("is refused with a reason when the problem is gone or its folder is not there", async () => {
    const f = fixture();
    await expect(f.service.plan({ type: "pending", key: "ci:alpha" })).rejects.toThrow(
      /no longer there/,
    );
    await expect(
      f.service.plan({
        type: "error",
        title: "Could not sync Alpha",
        cause: "x",
        folder: join(f.hub, "Nope"),
      }),
    ).rejects.toThrow(/not there/);
  });
});

describe("starting a Fix session", () => {
  it("starts one chat, remembers which problem it fixes, and lists it until the session is archived", async () => {
    const f = fixture();
    f.setItems([item({ key: "ci:alpha" })]);
    const events: unknown[] = [];
    f.deps.bus.on("fix.changed", (e) => events.push(e.payload));
    const row = await f.service.start({ type: "pending", key: "ci:alpha" }, "claude-code");
    expect(f.started).toHaveLength(1);
    expect(f.started[0]).toMatchObject({
      providerId: "claude-code",
      cwd: f.project,
      title: "Fix: CI failed in Alpha",
    });
    expect(f.started[0]?.prompt).toContain("AssertionError: expected 3 to be 4");
    expect(events).toEqual([{ key: "ci:alpha" }]);
    expect(f.service.list()).toEqual([
      { key: "ci:alpha", sessionId: row.id, title: "Fix: CI failed in Alpha" },
    ]);
    // A second click opens the same session instead of starting another.
    const again = await f.service.start({ type: "pending", key: "ci:alpha" }, "claude-code");
    expect(again.id).toBe(row.id);
    expect(f.started).toHaveLength(1);
    // Wrapping up the session does not resolve the problem, but an archived session no longer claims it.
    f.sessions.set(row.id, { ...row, archivedAt: "2026-01-02T00:00:00Z" });
    expect(f.service.list()).toEqual([]);
  });
});

describe("the helpers behind the message", () => {
  it("keeps one key for a problem on both sides of the app", () => {
    expect(fixKeyOf({ type: "pending", key: "ci:alpha" })).toBe("ci:alpha");
    expect(fixKeyOf({ type: "validate", message: "m", file: null, repo: null })).toBe("validate:m");
    expect(fixKeyOf({ type: "problem", key: "tool:codex", title: "t", detail: "d" })).toBe(
      "tool:codex",
    );
  });

  it("reads the run number, trims a log to its last failing step, and finds files", () => {
    expect(runIdOf("https://github.com/o/r/actions/runs/101")).toBe("101");
    expect(runIdOf("https://github.com/o/r")).toBeNull();
    const trimmed = trimFailedLog(FAILED_LOG);
    expect(trimmed.step).toBe("build / Test");
    expect(trimmed.text.split("\n")).toHaveLength(5);
    expect(trimFailedLog("").step).toBeNull();
    expect(trimFailedLog(FAILED_LOG, 2).text.split("\n")).toHaveLength(2);
    expect(filesFromText("at src\\a\\b.ts:3:4 and src/a/b.ts and node_modules/x/y.js")).toEqual([
      "src/a/b.ts",
    ]);
    expect(fixTitle("Fix: already")).toBe("Fix: already");
    expect(fixTitle("x".repeat(100)).length).toBeLessThanOrEqual(75);
    expect(buildFixBrief({ what: "w", where: "p", done: "d" })).not.toContain("```");
  });
});
