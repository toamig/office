import { IpcFailure } from "../../core/ipc";
import { git } from "./run";
import { readStatus } from "./status";

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

export interface CommitResult {
  hash: string;
  pushed: boolean;
  pushError?: string;
}

/** Commit messages never carry a Co-Authored-By trailer (plan 10, and the owner's rule). */
export function checkMessage(message: string): string {
  const clean = message.trim();
  if (!clean) throw new IpcFailure("no-message", "Write a commit message first");
  if (/^\s*co-authored-by\s*:/im.test(clean)) {
    throw new IpcFailure(
      "trailer",
      "Commit messages never carry a Co-Authored-By trailer. Remove that line.",
    );
  }
  return clean;
}

/**
 * Commits exactly the chosen files (new, changed and deleted ones), leaving anything else staged or
 * unstaged untouched, and optionally pushes. A failed push keeps the commit and is reported.
 */
export async function commitFiles(
  dir: string,
  files: string[],
  message: string,
  opts: { push?: boolean } = {},
): Promise<CommitResult> {
  const clean = checkMessage(message);
  if (files.length === 0) throw new IpcFailure("no-files", "Choose at least one file to commit");
  const add = await git(dir, ["add", "-A", "--", ...files]);
  if (add.code !== 0) throw new IpcFailure("add-failed", firstLine(add.stderr) || "git add failed");
  const commit = await git(dir, ["commit", "-m", clean, "--", ...files], { timeoutMs: 120_000 });
  if (commit.code !== 0) {
    throw new IpcFailure(
      "commit-failed",
      firstLine(commit.stderr) || firstLine(commit.stdout) || "git commit failed",
    );
  }
  const head = await git(dir, ["rev-parse", "--short", "HEAD"]);
  const result: CommitResult = { hash: head.stdout.trim(), pushed: false };
  if (opts.push) {
    const outcome = await pushCurrent(dir);
    result.pushed = outcome.ok;
    if (!outcome.ok) result.pushError = outcome.error;
  }
  return result;
}

/** `git push`, setting the upstream on the first push of a branch when `origin` exists. */
export async function pushCurrent(
  dir: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await readStatus(dir);
  const hasUpstream = status.ok && status.status.upstream !== null;
  const args = hasUpstream ? ["push"] : ["push", "-u", "origin", "HEAD"];
  const result = await git(dir, args, { timeoutMs: 120_000 });
  return result.code === 0
    ? { ok: true }
    : { ok: false, error: firstLine(result.stderr) || "git push failed" };
}
