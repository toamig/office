import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { operationInProgress, parseHubOutput, syncRepo } from "../../src/main/modules/git/sync";
import { syncAll, syncHub } from "../../src/main/modules/git/syncall";
import {
  cloneOf,
  commit,
  makeConflict,
  makeRepoPair,
  sh,
  tmp,
  write,
} from "../fixtures/repos/make";

describe("syncRepo", () => {
  it("pulls when behind with a clean tree", async () => {
    const pair = makeRepoPair();
    const other = cloneOf(pair);
    commit(other, "new.txt", "1", "remote work");
    sh(other, "push", "-q");
    expect(await syncRepo(pair.work)).toEqual({ action: "pulled" });
    expect(existsSync(join(pair.work, "new.txt"))).toBe(true);
  });

  it("pushes when ahead with a clean tree", async () => {
    const pair = makeRepoPair();
    commit(pair.work, "mine.txt", "1", "local work");
    expect(await syncRepo(pair.work)).toEqual({ action: "pushed" });
    expect(sh(pair.bare, "log", "-1", "--format=%s").trim()).toBe("local work");
  });

  it("rebases local commits onto remote ones and pushes", async () => {
    const pair = makeRepoPair();
    const other = cloneOf(pair);
    commit(other, "theirs.txt", "1", "remote work");
    sh(other, "push", "-q");
    commit(pair.work, "mine.txt", "1", "local work");
    expect(await syncRepo(pair.work)).toEqual({ action: "pulled-and-pushed" });
    expect(sh(pair.bare, "log", "--format=%s", "-2").trim().split("\n")).toEqual([
      "local work",
      "remote work",
    ]);
  });

  it("reports up to date", async () => {
    const pair = makeRepoPair();
    expect(await syncRepo(pair.work)).toEqual({ action: "up-to-date" });
  });

  it("skips the push when the working tree is dirty", async () => {
    const pair = makeRepoPair();
    commit(pair.work, "mine.txt", "1", "local work");
    write(pair.work, "README.md", "# dirty\n");
    const outcome = await syncRepo(pair.work);
    expect(outcome.action).toBe("skipped");
    expect(outcome.reason).toContain("uncommitted");
    expect(sh(pair.bare, "log", "-1", "--format=%s").trim()).toBe("initial commit");
  });

  it("pulls into a dirty tree only when the dirty files are not touched upstream", async () => {
    const pair = makeRepoPair();
    commit(pair.work, "keep.txt", "1", "add keep");
    sh(pair.work, "push", "-q");
    const other = cloneOf(pair);
    commit(other, "elsewhere.txt", "x", "remote work");
    sh(other, "push", "-q");
    write(pair.work, "keep.txt", "dirty edit");
    expect(await syncRepo(pair.work)).toEqual({ action: "pulled" });
    expect(existsSync(join(pair.work, "elsewhere.txt"))).toBe(true);

    commit(other, "keep.txt", "remote edit", "remote touches keep");
    sh(other, "push", "-q");
    const outcome = await syncRepo(pair.work);
    expect(outcome.action).toBe("skipped");
    expect(outcome.reason).toContain("keep.txt");
  });

  it("aborts a conflicting rebase and leaves the repo exactly as it was", async () => {
    const pair = makeRepoPair();
    makeConflict(pair);
    const before = sh(pair.work, "rev-parse", "HEAD").trim();
    const outcome = await syncRepo(pair.work);
    expect(outcome.action).toBe("conflict");
    expect(await operationInProgress(pair.work)).toBe(false);
    expect(sh(pair.work, "rev-parse", "HEAD").trim()).toBe(before);
    expect(sh(pair.work, "status", "--porcelain").trim()).toBe("");
  });

  it("skips a detached HEAD and a branch without upstream", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "checkout", "-q", "-b", "topic");
    expect((await syncRepo(pair.work)).reason).toBe("no upstream branch");
    sh(pair.work, "checkout", "-q", "--detach");
    expect((await syncRepo(pair.work)).reason).toBe("detached HEAD");
  });

  it("fails clearly when the remote is gone", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "remote", "set-url", "origin", join(pair.root, "missing.git"));
    const outcome = await syncRepo(pair.work);
    expect(outcome.action).toBe("failed");
    expect(outcome.reason).toContain("fetch failed");
  });
});

describe("hub output", () => {
  const pad = (folder: string, text: string): string => `${folder.padEnd(26)} ${text}`;

  it("turns the hub tool's lines into one result per repo", () => {
    const text = [
      pad("Common", "up to date"),
      pad("Polyglyph", "pulled 2"),
      pad("Polyglyph", "pushed 1"),
      pad("Vylora", "DIVERGED: 1 local, 1 remote, both changed A.md; needs judgment, not merged"),
      pad("Radar", "push failed: Permission denied"),
      pad(".", "1 uncommitted (not pushed; commit it first)"),
      "brain auto-sync: 2 pulled, 1 pushed, 2 need attention",
    ].join("\n");
    const results = parseHubOutput(text);
    expect(results.map((r) => [r.id, r.action])).toEqual([
      ["hub:Common", "up-to-date"],
      ["hub:Polyglyph", "pulled-and-pushed"],
      ["hub:Vylora", "conflict"],
      ["hub:Radar", "failed"],
      ["hub:.", "skipped"],
    ]);
    expect(results[3]?.pushFailed).toBe(true);
  });
});

describe("syncAll", () => {
  it("syncs every project four at a time and runs the hub tool for a brain hub", async () => {
    const a = makeRepoPair();
    const b = makeRepoPair();
    commit(a.work, "x.txt", "1", "ahead");
    const hub = tmp("office-hub-");
    mkdirSync(join(hub, "tools"));
    writeFileSync(
      join(hub, "tools", "hub.mjs"),
      "console.log('Common'.padEnd(26) + ' pulled 1'); console.log('brain auto-sync: 1 pulled');\n",
    );
    const root = tmp("office-projects-");
    const base = {
      pinned: false,
      archived: false,
    };
    const report = await syncAll({
      workspaceRoot: () => hub,
      projectsRoot: () => root,
      workspace: () => ({
        version: 1,
        vault: {
          kind: "brain-hub",
          openItemsFile: "OpenItems.md",
          waitingHeading: "Waiting on you",
        },
        projects: [
          { id: "a", name: "A", path: a.work, ...base },
          { id: "b", name: "B", path: b.work, ...base },
          { id: "hubself", name: "Hub", path: hub, ...base },
          { id: "old", name: "Old", path: a.work, pinned: false, archived: true },
        ],
        roles: {},
        pipelines: {},
        notifications: { urgent: [], mutedProjects: [] },
        automations: [],
        archiveAfterDays: 7,
        briefTime: "08:00",
      }),
    });
    expect(report.repos.map((r) => [r.id, r.action])).toEqual([
      ["a", "pushed"],
      ["b", "up-to-date"],
      ["hub:Common", "pulled"],
    ]);
  });
});

describe("syncHub", () => {
  function hubWith(script: string): string {
    const hub = tmp("office-hub-fail-");
    mkdirSync(join(hub, "tools"));
    writeFileSync(join(hub, "tools", "hub.mjs"), script);
    return hub;
  }
  const row = (id: string, rows: Awaited<ReturnType<typeof syncHub>>) =>
    rows.find((r) => r.id === id);

  it("adds a failed hub row when the tool exits with an error and prints no table", async () => {
    const hub = hubWith("console.error('fatal: not a git repository'); process.exit(3);");
    const rows = await syncHub(hub);
    expect(rows).toEqual([
      { id: "hub:.", name: "Brain hub", action: "failed", reason: "fatal: not a git repository" },
    ]);
  });

  it("adds a failed hub row even when the failing tool printed part of the table", async () => {
    const hub = hubWith(
      "console.log('Common'.padEnd(26) + ' pulled 1'); console.log('trace: boom'); process.exit(1);",
    );
    const rows = await syncHub(hub);
    expect(row("hub:Common", rows)?.action).toBe("pulled");
    expect(row("hub:.", rows)).toMatchObject({ action: "failed", reason: "trace: boom" });
  });

  it("adds a failed hub row when the tool does not finish in time", async () => {
    const hub = hubWith("setTimeout(() => {}, 60000);");
    const rows = await syncHub(hub, 700);
    expect(row("hub:.", rows)).toMatchObject({ action: "failed" });
    expect(row("hub:.", rows)?.reason).toContain("did not finish");
  });

  it("adds nothing for a tool that succeeded", async () => {
    const hub = hubWith("console.log('Common'.padEnd(26) + ' up to date');");
    const rows = await syncHub(hub);
    expect(rows.map((r) => r.id)).toEqual(["hub:Common"]);
  });
});
