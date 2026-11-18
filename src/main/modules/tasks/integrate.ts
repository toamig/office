import { git } from "../git/run";
import { removeWorktree } from "../git/worktrees";

export interface IntegrateInput {
  repo: string;
  branch: string;
  worktree: string;
  /** The branch the project was on when the task's worktree was made; null when it was detached. */
  baseBranch: string | null;
  title: string;
}

export interface IntegrateResult {
  merged: boolean;
  /** What went wrong or what was left behind, in words for the owner; null when all went well. */
  note: string | null;
}

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

/**
 * The last step of a Feature task, after the owner's final approval: the task branch is merged into the
 * branch the project was on, then its worktree and branch are removed. Anything unsafe (the project is on
 * another branch, has uncommitted changes, or the merge conflicts) leaves the branch and worktree alone
 * and says why, so the owner can merge from the Git view.
 */
export async function integrateTask(o: IntegrateInput): Promise<IntegrateResult> {
  const keep = (why: string): IntegrateResult => ({
    merged: false,
    note: `${o.branch} was not merged: ${why}. Its worktree is kept.`,
  });
  if (!o.baseBranch) return keep("the project had no branch checked out when the task started");

  // The builder may have left changes it could not commit (a headless run can be denied git).
  const leftovers = await git(o.worktree, ["status", "--porcelain"]);
  if (leftovers.stdout.trim() !== "") {
    await git(o.worktree, ["add", "-A"]);
    const saved = await git(o.worktree, [
      "commit",
      "-q",
      "-m",
      `${o.title}: changes left by the builder`,
    ]);
    if (saved.code !== 0)
      return keep(`its changes could not be committed (${firstLine(saved.stderr)})`);
  }

  const current = (await git(o.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  if (current !== o.baseBranch)
    return keep(`the project is on ${current || "no branch"}, not on ${o.baseBranch}`);
  const dirty = await git(o.repo, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.stdout.trim() !== "") return keep(`${o.baseBranch} has changes that are not committed`);

  const merge = await git(
    o.repo,
    ["merge", "--no-ff", "-m", `Merge ${o.branch}: ${o.title}`, o.branch],
    {
      timeoutMs: 120_000,
    },
  );
  if (merge.code !== 0) {
    await git(o.repo, ["merge", "--abort"]);
    return keep(`it conflicts with ${o.baseBranch} (${firstLine(merge.stdout || merge.stderr)})`);
  }

  try {
    await removeWorktree(o.repo, o.worktree);
  } catch (err) {
    return {
      merged: true,
      note: `${o.branch} was merged into ${o.baseBranch}, but its worktree was not removed: ${(err as Error).message}`,
    };
  }
  await git(o.repo, ["branch", "-d", o.branch]);
  return { merged: true, note: null };
}
