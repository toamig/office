import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitFile, LastCommit, RepoStatus } from "../../../shared/models";
import { git } from "./run";

/** Parses `git status --porcelain=v2 --branch -z` output. Pure, unit-tested against captured samples. */
export function parseStatusV2(output: string): RepoStatus {
  const status: RepoStatus = {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  const tokens = output.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token.startsWith("# ")) {
      readHeader(status, token);
      continue;
    }
    const kind = token[0];
    if (kind === "1") {
      const parts = splitFields(token, 8);
      pushFile(status, {
        path: parts.rest,
        index: parts.xy[0] ?? ".",
        worktree: parts.xy[1] ?? ".",
        kind: "ordinary",
      });
    } else if (kind === "2") {
      const parts = splitFields(token, 9);
      const orig = tokens[++i] ?? "";
      pushFile(status, {
        path: parts.rest,
        origPath: orig,
        index: parts.xy[0] ?? ".",
        worktree: parts.xy[1] ?? ".",
        kind: "renamed",
      });
    } else if (kind === "u") {
      const parts = splitFields(token, 10);
      pushFile(status, {
        path: parts.rest,
        index: parts.xy[0] ?? "U",
        worktree: parts.xy[1] ?? "U",
        kind: "unmerged",
      });
    } else if (kind === "?") {
      pushFile(status, { path: token.slice(2), index: "?", worktree: "?", kind: "untracked" });
    }
    // "!" (ignored) entries are not requested and are skipped.
  }
  return status;
}

function readHeader(status: RepoStatus, line: string): void {
  const [, key, ...rest] = line.split(" ");
  const value = rest.join(" ");
  if (key === "branch.oid") status.oid = value === "(initial)" ? null : value;
  else if (key === "branch.head") {
    status.detached = value === "(detached)";
    status.branch = status.detached ? null : value;
  } else if (key === "branch.upstream") status.upstream = value;
  else if (key === "branch.ab") {
    const m = /^\+(\d+) -(\d+)$/.exec(value);
    if (m) {
      status.ahead = Number(m[1]);
      status.behind = Number(m[2]);
    }
  }
}

/** Splits the first `n` space-separated fields off a status line; the remainder is the path. */
function splitFields(line: string, n: number): { xy: string; rest: string } {
  let pos = 0;
  const fields: string[] = [];
  for (let k = 0; k < n; k++) {
    const next = line.indexOf(" ", pos);
    fields.push(line.slice(pos, next));
    pos = next + 1;
  }
  // fields[0] is the record type, fields[1] is the XY pair.
  return { xy: fields[1] ?? "..", rest: line.slice(pos) };
}

function pushFile(status: RepoStatus, file: GitFile): void {
  status.files.push(file);
  if (file.kind === "untracked") status.untracked++;
  else if (file.kind === "unmerged") status.conflicted++;
  else {
    if (file.index !== ".") status.staged++;
    if (file.worktree !== ".") status.unstaged++;
  }
}

export type StatusResult = { ok: true; status: RepoStatus } | { ok: false; error: string };

/** Reads the status of the repo at `path`. */
export async function readStatus(path: string): Promise<StatusResult> {
  const result = await git(path, [
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
    "--untracked-files=normal",
  ]);
  if (result.code !== 0) {
    return { ok: false, error: result.stderr.trim() || `git status exited with ${result.code}` };
  }
  return { ok: true, status: parseStatusV2(result.stdout) };
}

/** The newest commit on HEAD, or null for an empty repo. */
export async function readLastCommit(path: string): Promise<LastCommit | null> {
  const result = await git(path, ["log", "-1", "--format=%H%x00%s%x00%cI"]);
  if (result.code !== 0) return null;
  const [hash, subject, date] = result.stdout.trim().split("\0");
  if (!hash || !date) return null;
  return { hash, subject: subject ?? "", date };
}

/** `origin` remote URL, or null. */
export async function readOrigin(path: string): Promise<string | null> {
  // The raw configured URL: `remote get-url` applies insteadOf rewrites, which would hide github.com.
  const result = await git(path, ["config", "--get", "remote.origin.url"]);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

/** True when `path` has a `.git` entry (folder, or file for worktrees). */
export function isGitFolder(path: string): boolean {
  return existsSync(join(path, ".git"));
}
