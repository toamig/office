import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  layoutGraph,
  parseLog,
  parseRefs,
  readGraph,
  type LogCommit,
} from "../../src/main/modules/git/graph";
import { FOLD_COLOR, foldLanes } from "../../src/shared/graph-lanes";

const commit = (hash: string, parents: string[], refs = "", subject = hash): LogCommit => ({
  hash,
  parents,
  refs,
  subject,
  author: "A",
  at: 0,
});

describe("the lanes of a branch graph", () => {
  it("a straight history is one lane, newest at the top", () => {
    const { rows, width } = layoutGraph([
      commit("c", ["b"], "HEAD -> main"),
      commit("b", ["a"]),
      commit("a", []),
    ]);
    expect(width).toBe(1);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows[0]?.fromAbove).toEqual([]);
    expect(rows[1]?.fromAbove).toEqual([{ lane: 0, color: 0 }]);
    expect(rows[2]?.toBelow).toEqual([]);
  });

  it("a fork: two branches that started from one commit are two lanes that meet at it", () => {
    // main and feature both started from c.
    const { rows, width } = layoutGraph([
      commit("m", ["c"], "HEAD -> main, origin/main"),
      commit("f", ["c"], "feature"),
      commit("c", ["a"]),
      commit("a", []),
    ]);
    expect(width).toBe(2);
    expect(rows[0]).toMatchObject({ col: 0, color: 0 });
    // The feature tip takes the second lane, in its own colour, while main's lane passes by it.
    expect(rows[1]).toMatchObject({ col: 1, color: 1 });
    expect(rows[1]?.through).toEqual([{ lane: 0, color: 0 }]);
    // Both lanes end at the fork commit, which carries on in the first.
    expect(rows[2]).toMatchObject({ col: 0 });
    expect(rows[2]?.fromAbove).toEqual([
      { lane: 0, color: 0 },
      { lane: 1, color: 1 },
    ]);
    expect(rows[2]?.toBelow).toEqual([{ to: 0, color: 0 }]);
    // The second lane is free again below the fork.
    expect(rows[3]?.fromAbove).toEqual([{ lane: 0, color: 0 }]);
    expect(rows[1]?.labels).toEqual([{ kind: "branch", name: "feature", current: false }]);
    expect(rows[0]?.labels).toEqual([
      { kind: "branch", name: "main", current: true },
      { kind: "remote", name: "origin/main", current: false },
    ]);
  });

  it("a merge: the merge commit leaves two lines, one into each parent's lane", () => {
    // m merges f into main; both come from a.
    const { rows } = layoutGraph([
      commit("m", ["p1", "p2"], "HEAD -> main"),
      commit("p1", ["a"]),
      commit("p2", ["a"], "feature"),
      commit("a", []),
    ]);
    expect(rows[0]?.toBelow).toEqual([
      { to: 0, color: 0 },
      { to: 1, color: 1 },
    ]);
    expect(rows[1]).toMatchObject({ col: 0 });
    expect(rows[1]?.through).toEqual([{ lane: 1, color: 1 }]);
    expect(rows[2]).toMatchObject({ col: 1 });
    expect(rows[3]?.fromAbove.map((f) => f.lane)).toEqual([0, 1]);
  });

  it("an octopus merge leaves one line per parent, each in its own lane", () => {
    const { rows, width } = layoutGraph([
      commit("o", ["a", "b", "c"], "HEAD -> main"),
      commit("a", ["z"]),
      commit("b", ["z"]),
      commit("c", ["z"]),
      commit("z", []),
    ]);
    expect(rows[0]?.toBelow.map((t) => t.to)).toEqual([0, 1, 2]);
    expect(new Set(rows[0]?.toBelow.map((t) => t.color)).size).toBe(3);
    expect(width).toBe(3);
    expect(rows.slice(1, 4).map((r) => r.col)).toEqual([0, 1, 2]);
    expect(rows[4]?.fromAbove.map((f) => f.lane)).toEqual([0, 1, 2]);
  });

  it("a detached HEAD is a label of its own, without a branch", () => {
    const { rows } = layoutGraph([commit("b", ["a"], "HEAD, tag: v1"), commit("a", [], "main")]);
    expect(rows[0]?.labels).toEqual([
      { kind: "head", name: "HEAD", current: true },
      { kind: "tag", name: "v1", current: false },
    ]);
    expect(rows[1]?.labels).toEqual([{ kind: "branch", name: "main", current: false }]);
  });

  it("two lines of history that never meet stay in separate lanes, and a lane is reused once free", () => {
    const { rows, width } = layoutGraph([
      commit("x2", ["x1"], "one"),
      commit("y2", ["y1"], "two"),
      commit("x1", []),
      commit("y1", []),
    ]);
    expect(width).toBe(2);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 1]);
    // A root ends its lane; nothing leaves it.
    expect(rows[2]?.toBelow).toEqual([]);
  });
});

describe("reading git's log", () => {
  it("splits the records, the parents and the decorations", () => {
    const line = [
      "abc123",
      "p1 p2",
      "HEAD -> main, tag: v2",
      "Fix: a thing",
      "Ana",
      "1760000000",
    ].join("\u0000");
    expect(parseLog(`${line}\n\n`)).toEqual([
      {
        hash: "abc123",
        parents: ["p1", "p2"],
        refs: "HEAD -> main, tag: v2",
        subject: "Fix: a thing",
        author: "Ana",
        at: 1760000000,
      },
    ]);
    expect(parseRefs("HEAD -> main, tag: v2").map((l) => l.kind)).toEqual(["branch", "tag"]);
    expect(parseLog("")).toEqual([]);
  });
});

describe("folding the lanes of a busy repo", () => {
  /** n commits each on a lane of its own, all waiting for one root: n parallel branches. */
  const many = (n: number) =>
    layoutGraph([
      ...Array.from({ length: n }, (_, i) => commit(`b${i}`, ["root"], `branch-${i}`)),
      commit("root", []),
    ]);

  it("leaves a graph that already fits alone", () => {
    const { rows, width } = many(5);
    const folded = foldLanes(rows, width, 12);
    expect(folded).toMatchObject({ width, hidden: 0 });
    expect(folded.rows).toBe(rows);
  });

  it("folds every lane past the cap into one muted lane, so the graph is never wider than the cap and one", () => {
    const { rows, width } = many(40);
    expect(width).toBe(40);
    const folded = foldLanes(rows, width, 12);
    expect(folded.width).toBe(13);
    expect(folded.hidden).toBe(27);
    for (const r of folded.rows) {
      expect(r.col).toBeLessThanOrEqual(12);
      for (const s of [...r.through, ...r.fromAbove]) expect(s.lane).toBeLessThanOrEqual(12);
      for (const t of r.toBelow) expect(t.to).toBeLessThanOrEqual(12);
      // One line per lane: the folded lane is drawn once, not once per branch in it.
      expect(new Set(r.through.map((s) => s.lane)).size).toBe(r.through.length);
    }
    // A branch past the cap has its dot in the folded lane, in the muted colour; the labels are kept.
    const far = folded.rows.find((r) => r.hash === "b30");
    expect(far).toMatchObject({ col: 12, color: FOLD_COLOR });
    expect(far?.labels).toEqual([{ kind: "branch", name: "branch-30", current: false }]);
    // Where the folded lanes meet the root, one line arrives from them.
    const root = folded.rows.at(-1);
    expect(root?.fromAbove.filter((f) => f.lane === 12)).toHaveLength(1);
    // The first lanes are untouched.
    expect(folded.rows[0]).toMatchObject({ col: 0, color: 0 });
    expect(folded.rows[11]).toMatchObject({ col: 11 });
  });
});

describe("a git log that fails", () => {
  it("is an error the owner can read, not an empty graph", async () => {
    const dir = mkdtempSync(join(tmpdir(), "office-notrepo-"));
    await expect(readGraph(dir, 300, [])).rejects.toThrow(/Git could not read the history/);
  });
});
