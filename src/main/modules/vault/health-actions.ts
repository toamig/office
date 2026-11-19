import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { DiffResult } from "../../../shared/models";
import { IpcFailure } from "../../core/ipc";
import { getDiff } from "../git/diff";
import { git, gitOk } from "../git/run";

/**
 * The fixes Office makes itself for the brain's health (Simplify 2.5): commit or discard the uncommitted files of a
 * hub repo, pull one that is behind, and push one that is ahead. A folder is only ever one
 * of the hub's own repos: the hub itself ("." or "") or a folder inside it that is a git repo.
 */
export interface HealthActionDeps {
  root: () => string;
  /** Called after a change, so the health check runs again. */
  changed: () => void;
}

/** The absolute folder of a hub repo, refusing anything that is not one inside the hub. */
export function repoDir(root: string, folder: string): string {
  const clean = folder === "." || folder === "" ? "" : folder;
  const dir = resolve(root, clean);
  const inside = dir === resolve(root) || dir.startsWith(resolve(root) + sep);
  if (!root || !inside || clean.includes("..") || !existsSync(join(dir, ".git"))) {
    throw new IpcFailure("not-a-repo", `${folder || "The hub"} is not one of the brain's repos`);
  }
  return dir;
}

export class HealthActions {
  constructor(private readonly deps: HealthActionDeps) {}

  /** What is uncommitted in the repo, with each file's changes, so the owner sees what Commit or Discard would take. */
  changes(folder: string): Promise<DiffResult> {
    return getDiff(repoDir(this.deps.root(), folder), "working");
  }

  /** Commits every change of the repo with the owner's message. */
  async commit(folder: string, message: string): Promise<string> {
    const dir = repoDir(this.deps.root(), folder);
    const text = message.trim() || "Update notes";
    await gitOk(dir, ["add", "-A"]);
    await gitOk(dir, ["commit", "-q", "-m", text]);
    const hash = (await gitOk(dir, ["rev-parse", "--short", "HEAD"])).trim();
    this.deps.changed();
    return hash;
  }

  /** Throws away every uncommitted change of the repo: tracked files go back, new files are removed. */
  async discard(folder: string): Promise<void> {
    const dir = repoDir(this.deps.root(), folder);
    await git(dir, ["reset", "-q"]);
    await gitOk(dir, ["checkout", "--", "."]);
    await gitOk(dir, ["clean", "-fdq"]);
    this.deps.changed();
  }

  /** Brings a repo that is behind up to date, never creating a merge. */
  async pull(folder: string): Promise<void> {
    const dir = repoDir(this.deps.root(), folder);
    await gitOk(dir, ["pull", "--ff-only", "-q"]);
    this.deps.changed();
  }

  /** Pushes a repo that is ahead. */
  async push(folder: string): Promise<void> {
    const dir = repoDir(this.deps.root(), folder);
    await gitOk(dir, ["push", "-q"]);
    this.deps.changed();
  }
}
