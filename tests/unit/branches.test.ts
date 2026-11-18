import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanMergedBranches,
  compareBranches,
  createBranch,
  defaultBranch,
  deleteBranch,
  listBranches,
  parseRefs,
  switchBranch,
} from "../../src/main/modules/git/branches";
import { cloneOf, commit, makeRepoPair, sh, write } from "../fixtures/repos/make";

const SEP = String.fromCharCode(31);
const line = (...parts: string[]): string => parts.join(SEP);

describe("parseRefs", () => {
  it("reads name, current marker, upstream and tracking counts", () => {
    const out = [
      line(
        "main",
        "*",
        "origin/main",
        "ahead 2, behind 1",
        "2026-11-19T10:00:00+00:00",
        "A subject",
        "abc1234",
      ),
      line("topic", " ", "", "", "2026-11-18T10:00:00+00:00", "Topic work", "def5678"),
      line("old", " ", "origin/old", "gone", "2026-01-01T10:00:00+00:00", "Stale", "0000000"),
      "",
    ].join("\n");
    const refs = parseRefs(out, false);
    expect(refs.map((r) => [r.name, r.current, r.upstream, r.ahead, r.behind, r.gone])).toEqual([
      ["main", true, "origin/main", 2, 1, false],
      ["topic", false, null, 0, 0, false],
      ["old", false, "origin/old", 0, 0, true],
    ]);
    expect(parseRefs(line("origin/HEAD", " ", "", "", "", "", ""), true)).toEqual([]);
  });
});

describe("branches on fixture repos", () => {
  it("lists local and remote branches with tracking and merged state", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "checkout", "-q", "-b", "merged-topic");
    commit(pair.work, "m.txt", "1", "merged work");
    sh(pair.work, "checkout", "-q", "main");
    sh(pair.work, "merge", "-q", "--no-ff", "-m", "merge topic", "merged-topic");
    sh(pair.work, "checkout", "-q", "-b", "open-topic");
    commit(pair.work, "o.txt", "1", "open work");
    sh(pair.work, "push", "-q", "-u", "origin", "open-topic");
    sh(pair.work, "checkout", "-q", "main");

    expect(await defaultBranch(pair.work)).toBe("main");
    const list = await listBranches(pair.work);
    expect(list.current).toBe("main");
    expect(list.defaultBranch).toBe("main");
    const byName = Object.fromEntries(list.local.map((b) => [b.name, b]));
    expect(byName["main"]).toMatchObject({ current: true, merged: false, upstream: "origin/main" });
    expect(byName["merged-topic"]?.merged).toBe(true);
    expect(byName["open-topic"]).toMatchObject({ merged: false, upstream: "origin/open-topic" });
    expect(list.remote.map((b) => b.name).sort()).toEqual(["origin/main", "origin/open-topic"]);
  });

  it("refuses to switch with a dirty tree and offers the stash, which then works", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "branch", "other");
    write(pair.work, "README.md", "# dirty\n");
    write(pair.work, "untracked.txt", "u");
    await expect(switchBranch(pair.work, "other")).rejects.toThrow(/uncommitted changes.*Stash/);
    expect(sh(pair.work, "branch", "--show-current").trim()).toBe("main");

    const result = await switchBranch(pair.work, "other", { stash: true });
    expect(result.stashed).toBe(true);
    expect(sh(pair.work, "branch", "--show-current").trim()).toBe("other");
    expect(sh(pair.work, "status", "--porcelain").trim()).toBe("");
    expect(sh(pair.work, "stash", "list")).toContain("office: before switching to other");
    expect(existsSync(join(pair.work, "untracked.txt"))).toBe(false);
  });

  it("switches cleanly, tracks a remote-only branch, and reports an unknown branch", async () => {
    const pair = makeRepoPair();
    const other = cloneOf(pair);
    sh(other, "checkout", "-q", "-b", "remote-only");
    commit(other, "r.txt", "r", "remote branch");
    sh(other, "push", "-q", "-u", "origin", "remote-only");
    sh(pair.work, "fetch", "-q");
    expect((await switchBranch(pair.work, "remote-only", { remote: false })).stashed).toBe(false);
    expect(sh(pair.work, "branch", "--show-current").trim()).toBe("remote-only");
    await expect(switchBranch(pair.work, "does-not-exist")).rejects.toThrow(
      /Could not switch|invalid reference/i,
    );
  });

  it("creates branches, validating the name and optionally switching", async () => {
    const pair = makeRepoPair();
    await createBranch(pair.work, "feature/one");
    expect(sh(pair.work, "branch", "--show-current").trim()).toBe("main");
    await createBranch(pair.work, "feature/two", { switchTo: true });
    expect(sh(pair.work, "branch", "--show-current").trim()).toBe("feature/two");
    await createBranch(pair.work, "from-main", { from: "main" });
    await expect(createBranch(pair.work, "bad name")).rejects.toThrow(/not a valid branch name/);
    await expect(createBranch(pair.work, "feature/one")).rejects.toThrow();
  });

  it("compares two branches by commits on each side and a file summary", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "checkout", "-q", "-b", "left");
    commit(pair.work, "l.txt", "l", "left work");
    sh(pair.work, "checkout", "-q", "main");
    sh(pair.work, "checkout", "-q", "-b", "right");
    commit(pair.work, "r1.txt", "r", "right one");
    commit(pair.work, "r2.txt", "r", "right two");
    const cmp = await compareBranches(pair.work, "left", "right");
    expect(cmp.onlyInA.map((c) => c.slice(8))).toEqual(["left work"]);
    expect(cmp.onlyInB.map((c) => c.slice(8))).toEqual(["right two", "right one"]);
    expect(cmp.stat).toContain("r1.txt");
    expect(cmp.stat).toContain("r2.txt");
    expect(cmp.stat).not.toContain("l.txt");
  });

  it("deletes merged branches and refuses the current or an unmerged one", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "checkout", "-q", "-b", "done-one");
    commit(pair.work, "d1.txt", "1", "done one");
    sh(pair.work, "checkout", "-q", "main");
    sh(pair.work, "merge", "-q", "--ff-only", "done-one");
    sh(pair.work, "checkout", "-q", "-b", "done-two");
    sh(pair.work, "checkout", "-q", "main");
    sh(pair.work, "checkout", "-q", "-b", "unmerged");
    commit(pair.work, "u.txt", "u", "unmerged work");

    await expect(deleteBranch(pair.work, "unmerged")).rejects.toThrow(/checked out/);
    sh(pair.work, "checkout", "-q", "main");
    await expect(deleteBranch(pair.work, "unmerged")).rejects.toThrow(/not fully merged/);
    await deleteBranch(pair.work, "done-one");
    expect(sh(pair.work, "branch", "--format=%(refname:short)").split("\n")).not.toContain(
      "done-one",
    );

    const removed = await cleanMergedBranches(pair.work);
    expect(removed).toEqual(["done-two"]);
    const left = sh(pair.work, "branch", "--format=%(refname:short)").trim().split("\n").sort();
    expect(left).toEqual(["main", "unmerged"]);
  });
});
