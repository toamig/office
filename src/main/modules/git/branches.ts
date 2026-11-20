import type { BranchCompare, BranchInfo, BranchList } from "../../../shared/models";
import { IpcFailure } from "../../core/ipc";
import { git } from "./run";
import { readStatus } from "./status";

const SEP = "\u001f";
const FORMAT = [
  "%(refname:short)",
  "%(HEAD)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(committerdate:iso-strict)",
  "%(subject)",
  "%(objectname:short)",
].join("%1f");

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

/** The branch Office treats as "main": origin/HEAD when set, else main, else master. */
export async function defaultBranch(path: string): Promise<string | null> {
  const head = await git(path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0) return head.stdout.trim().replace(/^origin\//, "");
  for (const name of ["main", "master"]) {
    if ((await git(path, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])).code === 0)
      return name;
  }
  return null;
}

function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  return {
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    gone: track.includes("gone"),
  };
}

/** Parses `git for-each-ref` output made with FORMAT. Pure, so it is tested against samples. */
export function parseRefs(output: string, remote: boolean): BranchInfo[] {
  const out: BranchInfo[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [name, head, upstream, track, date, subject, hash] = line.split(SEP);
    if (!name || name.endsWith("/HEAD")) continue;
    const t = parseTrack(track ?? "");
    out.push({
      name,
      current: head === "*",
      upstream: upstream || null,
      ahead: t.ahead,
      behind: t.behind,
      gone: t.gone,
      lastCommit: date || null,
      subject: subject ?? "",
      hash: hash ?? "",
      remote,
      merged: false,
    });
  }
  return out;
}

/** Local and remote branches, with which ones are merged into the default branch. */
export async function listBranches(path: string): Promise<BranchList> {
  const [locals, remotes, base] = await Promise.all([
    git(path, ["for-each-ref", `--format=${FORMAT}`, "refs/heads"]),
    git(path, ["for-each-ref", `--format=${FORMAT}`, "refs/remotes"]),
    defaultBranch(path),
  ]);
  if (locals.code !== 0)
    throw new IpcFailure("git-failed", firstLine(locals.stderr) || "git could not list branches");
  const local = parseRefs(locals.stdout, false);
  const remote = parseRefs(remotes.stdout, true);
  let mergedNames = new Set<string>();
  if (base) {
    const merged = await git(path, ["branch", "--merged", base, "--format=%(refname:short)"]);
    if (merged.code === 0)
      mergedNames = new Set(
        merged.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      );
  }
  for (const b of local) b.merged = mergedNames.has(b.name) && b.name !== base;
  return {
    current: local.find((b) => b.current)?.name ?? null,
    defaultBranch: base,
    local,
    remote,
  };
}

/** Throws when the working tree has changes a switch could lose or carry along. */
async function dirtyCount(path: string): Promise<number> {
  const status = await readStatus(path);
  if (!status.ok) throw new IpcFailure("git-failed", firstLine(status.error));
  return status.status.files.length;
}

export interface SwitchResult {
  stashed: boolean;
}

/**
 * Switches branch. A dirty tree is refused with a message that offers the stash; with `stash` set the
 * changes are stashed first (untracked files too), under a name that says why.
 */
export async function switchBranch(
  path: string,
  name: string,
  opts: { stash?: boolean; remote?: boolean; detach?: boolean } = {},
): Promise<SwitchResult> {
  const dirty = await dirtyCount(path);
  let stashed = false;
  if (dirty > 0) {
    if (!opts.stash) {
      throw new IpcFailure(
        "dirty-tree",
        `${dirty} file(s) have uncommitted changes. Stash them first, or commit them, before switching to ${name}.`,
      );
    }
    const stash = await git(path, [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      `office: before switching to ${name}`,
    ]);
    if (stash.code !== 0) throw new IpcFailure("stash-failed", firstLine(stash.stderr));
    stashed = true;
  }
  // Checking out a commit leaves HEAD on no branch (detached).
  const args = opts.detach
    ? ["switch", "--detach", name]
    : opts.remote
      ? ["switch", "--track", name]
      : ["switch", name];
  const result = await git(path, args);
  if (result.code !== 0) {
    if (stashed) await git(path, ["stash", "pop"]);
    throw new IpcFailure(
      "switch-failed",
      firstLine(result.stderr) || `Could not switch to ${name}`,
    );
  }
  return { stashed };
}

/** Creates a branch (validating its name), optionally from another one, and optionally switches to it. */
export async function createBranch(
  path: string,
  name: string,
  opts: { from?: string; switchTo?: boolean } = {},
): Promise<void> {
  const valid = await git(path, ["check-ref-format", "--branch", name]);
  if (valid.code !== 0) throw new IpcFailure("bad-name", `"${name}" is not a valid branch name`);
  const args = opts.switchTo ? ["switch", "-c", name] : ["branch", name];
  if (opts.from) args.push(opts.from);
  const result = await git(path, args);
  if (result.code !== 0) throw new IpcFailure("create-failed", firstLine(result.stderr));
}

const subjects = async (path: string, range: string): Promise<string[]> => {
  const out = await git(path, ["log", range, "--format=%h %s", "--no-merges"]);
  return out.code === 0 ? out.stdout.split("\n").filter(Boolean) : [];
};

/** What differs between two branches: commits only on each side, and the changed-file summary. */
export async function compareBranches(path: string, a: string, b: string): Promise<BranchCompare> {
  const [onlyInB, onlyInA, stat] = await Promise.all([
    subjects(path, `${a}..${b}`),
    subjects(path, `${b}..${a}`),
    git(path, ["diff", "--stat", "--no-color", `${a}...${b}`]),
  ]);
  return { a, b, onlyInA, onlyInB, stat: stat.code === 0 ? stat.stdout.trim() : "" };
}

/** Deletes a branch that is merged (`git branch -d`); the current branch is refused. */
export async function deleteBranch(path: string, name: string): Promise<void> {
  const current = await git(path, ["branch", "--show-current"]);
  if (current.stdout.trim() === name)
    throw new IpcFailure("is-current", "That branch is checked out. Switch away from it first.");
  const result = await git(path, ["branch", "-d", name]);
  if (result.code !== 0)
    throw new IpcFailure("not-merged", firstLine(result.stderr) || `${name} is not merged`);
}

/** Deletes every local branch merged into the default branch, except the current and default ones. */
export async function cleanMergedBranches(path: string): Promise<string[]> {
  const list = await listBranches(path);
  const removed: string[] = [];
  for (const b of list.local) {
    if (!b.merged || b.current || b.name === list.defaultBranch) continue;
    const result = await git(path, ["branch", "-d", b.name]);
    if (result.code === 0) removed.push(b.name);
  }
  return removed;
}
