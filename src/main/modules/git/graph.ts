import type { GraphLabel, GraphRow, GraphView } from "../../../shared/models";
import { IpcFailure } from "../../core/ipc";
import { parseUnifiedDiff } from "./diff";
import { git } from "./run";

/** One commit as `git log` gives it, before it is placed in a lane. */
export interface LogCommit {
  hash: string;
  parents: string[];
  /** The raw `%D` decoration: "HEAD -> main, origin/main, tag: v1". */
  refs: string;
  subject: string;
  author: string;
  /** Unix seconds. */
  at: number;
}

const FIELD = "\u0000";
export const GRAPH_FORMAT = ["%H", "%P", "%D", "%s", "%an", "%at"].join("%x00");

/** Reads the records of `git log --format=GRAPH_FORMAT`, one commit per line. */
export function parseLog(stdout: string): LogCommit[] {
  const out: LogCommit[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [hash = "", parents = "", refs = "", subject = "", author = "", at = "0"] =
      line.split(FIELD);
    if (!hash) continue;
    out.push({
      hash,
      parents: parents.split(" ").filter(Boolean),
      refs,
      subject,
      author,
      at: Number(at) || 0,
    });
  }
  return out;
}

/** The labels of a commit: branches, remote branches, tags, and HEAD (alone when HEAD is detached). */
export function parseRefs(refs: string): GraphLabel[] {
  const labels: GraphLabel[] = [];
  for (const raw of refs.split(",")) {
    const ref = raw.trim();
    if (!ref) continue;
    if (ref === "HEAD") labels.push({ kind: "head", name: "HEAD", current: true });
    else if (ref.startsWith("HEAD -> "))
      labels.push({ kind: "branch", name: ref.slice(8), current: true });
    else if (ref.startsWith("tag: "))
      labels.push({ kind: "tag", name: ref.slice(5), current: false });
    else if (ref.includes("/") && !ref.startsWith("refs/"))
      // "origin/main" is a remote branch; a local branch can have a slash too, so the caller checks the remotes it knows.
      labels.push({ kind: "remote", name: ref, current: false });
    else labels.push({ kind: "branch", name: ref, current: false });
  }
  return labels;
}

/**
 * Places commits (newest first, in topological order) in lanes. A lane is a column that is waiting for one commit:
 * the parent of the commit above it. A commit takes the lane that waits for it (several lanes waiting for the same
 * commit are a fork: the branches above started from it), and hands its first parent the same lane; any other
 * parent (a merge, or an octopus) gets a lane of its own, which meets the others at that parent.
 */
export function layoutGraph(commits: LogCommit[]): { rows: GraphRow[]; width: number } {
  interface Lane {
    hash: string;
    color: number;
  }
  const lanes: Array<Lane | null> = [];
  let nextColor = 0;
  let width = 1;
  const firstFree = (not?: number): number => {
    const i = lanes.findIndex((l, at) => l === null && at !== not);
    return i >= 0 ? i : lanes.length;
  };
  const rows: GraphRow[] = [];
  for (const c of commits) {
    const waiting = lanes.flatMap((l, i) => (l?.hash === c.hash ? [i] : []));
    const col = waiting[0] ?? firstFree();
    const color = waiting.length > 0 ? (lanes[col]?.color ?? 0) : nextColor++;
    const fromAbove = waiting.map((i) => ({ lane: i, color: lanes[i]?.color ?? 0 }));
    for (const i of waiting) lanes[i] = null;
    const through = lanes.flatMap((l, i) => (l ? [{ lane: i, color: l.color }] : []));
    const toBelow: GraphRow["toBelow"] = [];
    const [first, ...others] = c.parents;
    if (first !== undefined) {
      // The first parent carries on in this lane; every other parent gets a lane of its own. Lanes that wait for the
      // same commit meet there: that is where a branch started (a fork) or where one was merged (a join).
      lanes[col] = { hash: first, color };
      toBelow.push({ to: col, color });
      for (const p of others) {
        const j = firstFree(col);
        const merged = { hash: p, color: nextColor++ };
        lanes[j] = merged;
        toBelow.push({ to: j, color: merged.color });
      }
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    const rowWidth = Math.max(
      col + 1,
      ...through.map((t) => t.lane + 1),
      ...fromAbove.map((t) => t.lane + 1),
      ...toBelow.map((t) => t.to + 1),
    );
    width = Math.max(width, rowWidth);
    rows.push({
      hash: c.hash,
      short: c.hash.slice(0, 7),
      subject: c.subject,
      author: c.author,
      at: c.at,
      parents: c.parents,
      col,
      color,
      fromAbove,
      through,
      toBelow,
      labels: parseRefs(c.refs),
    });
  }
  return { rows, width };
}

/**
 * The graph of a repo: the newest `limit` commits of every branch, in lanes. One more commit is asked for, so the
 * view knows whether Load more has anything to load.
 */
export async function readGraph(dir: string, limit: number, remotes: string[]): Promise<GraphView> {
  const out = await git(dir, [
    "log",
    "--all",
    "--topo-order",
    `--format=${GRAPH_FORMAT}`,
    "-n",
    String(limit + 1),
  ]);
  // A failing log is an error the owner can see, never an empty graph.
  if (out.code !== 0)
    throw new IpcFailure(
      "git-failed",
      `Git could not read the history: ${out.stderr.trim().split("\n")[0] || `exit ${out.code}`}`,
    );
  const all = parseLog(out.stdout);
  const commits = all.slice(0, limit);
  const { rows, width } = layoutGraph(commits);
  // A ref with a slash is a remote branch only when its first part is a remote of this repo.
  for (const row of rows)
    for (const label of row.labels)
      if (label.kind === "remote" && !remotes.includes(label.name.split("/")[0] ?? ""))
        label.kind = "branch";
  const head = rows
    .flatMap((r) => r.labels.map((l) => ({ row: r, label: l })))
    .find((x) => x.label.current);
  return {
    rows,
    width,
    hasMore: all.length > limit,
    head: head
      ? { hash: head.row.hash, branch: head.label.kind === "branch" ? head.label.name : null }
      : { hash: null, branch: null },
    detached: head?.label.kind === "head",
  };
}

/** What one commit changed, with its message: `git show` of a hash the caller has already seen in the graph. */
export async function showCommit(
  dir: string,
  hash: string,
): Promise<{ subject: string; body: string; files: ReturnType<typeof parseUnifiedDiff> }> {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new IpcFailure("bad-hash", "That is not a commit");
  const message = await git(dir, ["log", "-1", "--format=%s%x00%b", hash]);
  const diff = await git(dir, ["show", "--no-color", "--no-ext-diff", "--format=", hash]);
  if (message.code !== 0 || diff.code !== 0)
    throw new IpcFailure(
      "git-failed",
      `Git could not show that commit: ${(diff.stderr || message.stderr).trim().split("\n")[0] ?? ""}`,
    );
  const [subject = "", body = ""] = message.stdout.split("\u0000");
  return { subject: subject.trim(), body: body.trim(), files: parseUnifiedDiff(diff.stdout) };
}
