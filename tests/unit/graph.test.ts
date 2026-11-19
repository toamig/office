import { describe, expect, it } from "vitest";
import { layoutGraph, parseLog, parseRefs, type LogCommit } from "../../src/main/modules/git/graph";

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
