import { describe, expect, it } from "vitest";
import { readGraph } from "../../src/main/modules/git/graph";
import { commit, makeRepoPair, sh } from "../fixtures/repos/make";

/** A real repo with a fork, a merge, a tag and a remote branch. */
function history() {
  const { work } = makeRepoPair();
  sh(work, "checkout", "-q", "-b", "feature");
  commit(work, "f.txt", "f\n", "On feature");
  sh(work, "checkout", "-q", "main");
  commit(work, "m.txt", "m\n", "On main");
  sh(work, "merge", "-q", "--no-ff", "feature", "-m", "Merge feature");
  sh(work, "tag", "v1");
  return work;
}

describe("the graph of a real repo", () => {
  it("lays the branches out in lanes, with names at their heads and the checked-out branch marked", async () => {
    const work = history();
    const g = await readGraph(work, 300, ["origin"]);
    expect(g.rows[0]).toMatchObject({ subject: "Merge feature", col: 0 });
    expect(g.rows[0]?.parents).toHaveLength(2);
    expect(g.rows[0]?.toBelow).toHaveLength(2);
    expect(g.rows[0]?.labels).toEqual(
      expect.arrayContaining([
        { kind: "branch", name: "main", current: true },
        { kind: "tag", name: "v1", current: false },
      ]),
    );
    // The remote branch is where the remote is: on the first commit, not the unpushed merge.
    expect(g.rows.at(-1)?.labels).toContainEqual({
      kind: "remote",
      name: "origin/main",
      current: false,
    });
    expect(g.head).toEqual({ hash: g.rows[0]?.hash, branch: "main" });
    expect(g.detached).toBe(false);
    expect(g.width).toBe(2);
    expect(g.hasMore).toBe(false);
    // Every commit appears once, the first one last.
    expect(g.rows.map((r) => r.subject)).toEqual(
      expect.arrayContaining(["On feature", "On main", "Merge feature"]),
    );
    expect(g.rows.at(-1)?.parents).toEqual([]);
  });

  it("a detached HEAD has no branch, and a limit says there is more to load", async () => {
    const work = history();
    sh(work, "checkout", "-q", "--detach", "v1~1");
    const g = await readGraph(work, 300, ["origin"]);
    expect(g.detached).toBe(true);
    expect(g.head.branch).toBeNull();
    expect(g.rows.some((r) => r.labels.some((l) => l.kind === "head"))).toBe(true);
    const short = await readGraph(work, 2, ["origin"]);
    expect(short.rows).toHaveLength(2);
    expect(short.hasMore).toBe(true);
  });

  it("a branch whose name has a slash is a branch, not a remote", async () => {
    const work = history();
    sh(work, "branch", "office/task-one");
    const g = await readGraph(work, 300, ["origin"]);
    const labels = g.rows.flatMap((r) => r.labels);
    expect(labels).toContainEqual({ kind: "branch", name: "office/task-one", current: false });
  });
});
