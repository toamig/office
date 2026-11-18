import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { WorktreeInfo } from "../../../shared/models";
import { IpcFailure } from "../../core/ipc";
import { defaultBranch, listBranches } from "./branches";
import { git } from "./run";
import { readStatus } from "./status";

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";
const norm = (p: string): string => resolve(p).replace(/\\/g, "/").toLowerCase();

export type WorktreeKind = WorktreeInfo["kind"];

interface Raw {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Parses `git worktree list --porcelain`: blocks separated by a blank line. Pure. */
export function parseWorktrees(output: string): Raw[] {
  const out: Raw[] = [];
  for (const block of output.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) continue;
    const raw: Raw = {
      path: "",
      head: "",
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
    };
    for (const line of lines) {
      const [key, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "worktree") raw.path = value;
      else if (key === "HEAD") raw.head = value;
      else if (key === "branch") raw.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "bare") raw.bare = true;
      else if (key === "detached") raw.detached = true;
      else if (key === "locked") raw.locked = true;
      else if (key === "prunable") raw.prunable = true;
    }
    if (raw.path) out.push(raw);
  }
  return out;
}

/** Where a worktree came from: the main checkout, Office, the Claude app, or something else. */
export function classify(repo: string, path: string, index: number): WorktreeKind {
  if (index === 0) return "main";
  const rel = relative(resolve(repo), resolve(path)).replace(/\\/g, "/");
  if (rel.startsWith(".office/worktrees/")) return "office";
  if (rel.startsWith(".claude/worktrees/")) return "claude";
  return "other";
}

/** Every worktree of a repo, with its branch, origin and whether it has uncommitted changes. */
export async function listWorktrees(repo: string): Promise<WorktreeInfo[]> {
  const result = await git(repo, ["worktree", "list", "--porcelain"]);
  if (result.code !== 0)
    throw new IpcFailure("git-failed", firstLine(result.stderr) || "git could not list worktrees");
  const raws = parseWorktrees(result.stdout);
  return Promise.all(
    raws.map(async (raw, index) => {
      let dirty = 0;
      if (existsSync(raw.path) && !raw.bare) {
        const status = await readStatus(raw.path);
        if (status.ok) dirty = status.status.files.length;
      }
      return {
        path: resolve(raw.path),
        branch: raw.branch,
        head: raw.head.slice(0, 7),
        detached: raw.detached,
        locked: raw.locked,
        prunable: raw.prunable,
        dirty,
        kind: classify(repo, raw.path, index),
      };
    }),
  );
}

/** Adds `.office/` to the repo's local exclude file (never to .gitignore), once. */
export async function excludeOfficeFolder(repo: string): Promise<void> {
  const common = await git(repo, ["rev-parse", "--git-common-dir"]);
  if (common.code !== 0) return;
  const dir = common.stdout.trim();
  const file = join(isAbsolute(dir) ? dir : join(repo, dir), "info", "exclude");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.split(/\r?\n/).includes(".office/")) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}.office/\n`);
}

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** A new worktree for a task: `<repo>/.office/worktrees/<slug>` on branch `office/<slug>` (plan 10). */
export async function createWorktree(
  repo: string,
  name: string,
  base?: string,
): Promise<{ path: string; branch: string }> {
  const slug = slugOf(name);
  if (!slug)
    throw new IpcFailure("bad-name", "Give the worktree a name with letters or digits in it");
  const path = resolve(repo, ".office", "worktrees", slug);
  const branch = `office/${slug}`;
  if (existsSync(path))
    throw new IpcFailure("exists", `A worktree called "${slug}" already exists`);
  await excludeOfficeFolder(repo);
  mkdirSync(dirname(path), { recursive: true });
  const args = ["worktree", "add", path, "-b", branch];
  if (base) args.push(base);
  const result = await git(repo, args);
  if (result.code !== 0)
    throw new IpcFailure(
      "worktree-failed",
      firstLine(result.stderr) || "git could not add the worktree",
    );
  return { path, branch };
}

/**
 * Removes a worktree. A dirty one is refused. Worktrees other tools made are only removed when the
 * caller says it confirmed that with the owner.
 */
export async function removeWorktree(
  repo: string,
  path: string,
  opts: { confirmOther?: boolean } = {},
): Promise<void> {
  const all = await listWorktrees(repo);
  const target = all.find((w) => norm(w.path) === norm(path));
  if (!target) throw new IpcFailure("not-found", "That worktree does not belong to this repo");
  if (target.kind === "main")
    throw new IpcFailure(
      "is-main",
      "That is the main checkout of the repo; it cannot be removed here",
    );
  if (target.dirty > 0)
    throw new IpcFailure(
      "dirty-tree",
      `${target.dirty} file(s) in that worktree have uncommitted changes. Commit or discard them first.`,
    );
  if (target.kind !== "office" && !opts.confirmOther) {
    throw new IpcFailure(
      "needs-confirm",
      "This worktree was made by another tool. Confirm to remove it.",
    );
  }
  const result = await git(repo, ["worktree", "remove", target.path]);
  if (result.code !== 0)
    throw new IpcFailure(
      "worktree-failed",
      firstLine(result.stderr) || "git could not remove the worktree",
    );
}

/** Removes Office worktrees whose branch is already merged into the default branch, and deletes those branches. */
export async function cleanMergedWorktrees(repo: string): Promise<string[]> {
  const base = await defaultBranch(repo);
  if (!base) return [];
  const [worktrees, branches] = await Promise.all([listWorktrees(repo), listBranches(repo)]);
  const merged = new Set(branches.local.filter((b) => b.merged).map((b) => b.name));
  const removed: string[] = [];
  for (const w of worktrees) {
    if (w.kind !== "office" || !w.branch || !merged.has(w.branch) || w.dirty > 0) continue;
    const gone = await git(repo, ["worktree", "remove", w.path]);
    if (gone.code !== 0) continue;
    await git(repo, ["branch", "-d", w.branch]);
    removed.push(w.branch);
  }
  return removed;
}
