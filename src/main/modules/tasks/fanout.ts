import type { TaskVariant } from "../../../shared/models";
import type { Role } from "../../../shared/types";
import type { Db } from "../../core/db";
import { IpcFailure } from "../../core/ipc";
import { git } from "../git/run";
import { createWorktree } from "../git/worktrees";
import type { RunHandle, RunService } from "../runs/service";

interface VariantRow {
  task_id: string;
  stage_idx: number;
  n: number;
  branch: string;
  worktree: string;
  run_id: string | null;
  status: TaskVariant["status"];
  error: string | null;
}

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

/** Several builders working in parallel on the same stage, each in its own worktree and branch. */
export class FanOut {
  private readonly handles = new Map<string, RunHandle[]>();

  constructor(
    private readonly deps: { db: Db; runs: RunService; changed: (taskId: string) => void },
  ) {}

  rows(taskId: string): VariantRow[] {
    return this.deps.db
      .prepare("SELECT * FROM task_variants WHERE task_id = ? ORDER BY stage_idx, n")
      .all(taskId) as VariantRow[];
  }

  /** True while some builder finished (or failed) but none was chosen yet. */
  awaitingChoice(taskId: string): boolean {
    const rows = this.rows(taskId);
    return (
      rows.length > 0 &&
      !rows.some((r) => r.status === "kept") &&
      !rows.every((r) => r.status === "discarded")
    );
  }

  private setStatus(
    taskId: string,
    idx: number,
    n: number,
    status: TaskVariant["status"],
    error: string | null = null,
  ): void {
    this.deps.db
      .prepare(
        "UPDATE task_variants SET status = ?, error = ? WHERE task_id = ? AND stage_idx = ? AND n = ?",
      )
      .run(status, error, taskId, idx, n);
    this.deps.changed(taskId);
  }

  /**
   * Starts `count` builders, one worktree each, branched from the task branch, and waits for all of them.
   * Returns how many succeeded.
   */
  async run(o: {
    taskId: string;
    stageIdx: number;
    count: number;
    repo: string;
    taskBranch: string;
    slug: string;
    role: Role;
    projectId: string;
    prompt: string;
    providerId: string;
  }): Promise<number> {
    const handles: RunHandle[] = [];
    this.handles.set(o.taskId, handles);
    const insert = this.deps.db.prepare(
      "INSERT INTO task_variants (task_id, stage_idx, n, branch, worktree, run_id, status) VALUES (?, ?, ?, ?, ?, ?, 'running')",
    );
    const pending: Array<Promise<boolean>> = [];
    for (let n = 1; n <= o.count; n++) {
      let made: { path: string; branch: string };
      try {
        made = await createWorktree(o.repo, `${o.slug} v${n}`, o.taskBranch);
      } catch (err) {
        // The builders already started keep running; this one is recorded as failed, with the reason.
        this.deps.db
          .prepare(
            "INSERT INTO task_variants (task_id, stage_idx, n, branch, worktree, run_id, status, error) VALUES (?, ?, ?, '', '', NULL, 'failed', ?)",
          )
          .run(o.taskId, o.stageIdx, n, (err as Error).message);
        this.deps.changed(o.taskId);
        continue;
      }
      const prompt = `${o.prompt}\n\nYou are builder ${n} of ${o.count}, working in parallel with the others. Work only in this folder and commit your work here.`;
      const handle = this.deps.runs.start({
        kind: "stage",
        providerId: o.providerId,
        role: o.role,
        cwd: made.path,
        prompt,
        projectId: o.projectId,
        taskId: o.taskId,
      });
      handles.push(handle);
      insert.run(o.taskId, o.stageIdx, n, made.branch, made.path, handle.id);
      this.deps.changed(o.taskId);
      pending.push(
        handle.result.then((result) => {
          this.setStatus(
            o.taskId,
            o.stageIdx,
            n,
            result.ok ? "done" : "failed",
            result.ok ? null : (result.error ?? "The run failed"),
          );
          return result.ok;
        }),
      );
    }
    const outcomes = await Promise.all(pending);
    this.handles.delete(o.taskId);
    return outcomes.filter(Boolean).length;
  }

  cancel(taskId: string): void {
    for (const h of this.handles.get(taskId) ?? []) h.run.cancel();
  }

  /**
   * Removes every variant worktree and branch of a task (used before a re-run and after a choice).
   * Returns what could not be removed; those builders keep their status so a later call tries again.
   */
  async discardAll(taskId: string, repo: string, except?: number): Promise<string[]> {
    const problems: string[] = [];
    for (const v of this.rows(taskId)) {
      if (v.status === "discarded" || v.n === except) continue;
      if (v.worktree) {
        const removed = await git(repo, ["worktree", "remove", "--force", v.worktree]);
        if (removed.code !== 0) {
          problems.push(`builder ${v.n} worktree: ${firstLine(removed.stderr)}`);
          continue;
        }
        const branch = await git(repo, ["branch", "-D", v.branch]);
        if (branch.code !== 0) {
          problems.push(`builder ${v.n} branch ${v.branch}: ${firstLine(branch.stderr)}`);
          continue;
        }
      }
      this.setStatus(taskId, v.stage_idx, v.n, "discarded");
    }
    return problems;
  }

  /**
   * Keeps one builder: its leftover changes are committed, its branch is merged into the task branch
   * (a conflict aborts the merge and nothing changes), and all the other worktrees are removed.
   */
  async keep(
    taskId: string,
    n: number,
    o: { repo: string; taskWorktree: string },
  ): Promise<string[]> {
    const chosen = this.rows(taskId).find(
      (r) => r.n === n && (r.status === "done" || r.status === "failed"),
    );
    if (!chosen) throw new IpcFailure("no-variant", "That builder's result is not available");
    if (chosen.status === "failed")
      throw new IpcFailure("failed-variant", "That builder failed; pick one that finished");
    await git(chosen.worktree, ["add", "-A"]);
    const staged = await git(chosen.worktree, ["diff", "--cached", "--quiet"]);
    if (staged.code !== 0) {
      const commit = await git(chosen.worktree, ["commit", "-q", "-m", "Builder changes"]);
      if (commit.code !== 0) throw new IpcFailure("commit-failed", firstLine(commit.stderr));
    }
    const merge = await git(o.taskWorktree, [
      "merge",
      "--no-ff",
      "-m",
      `Merge ${chosen.branch}`,
      chosen.branch,
    ]);
    if (merge.code !== 0) {
      const unmerged = await git(o.taskWorktree, ["diff", "--name-only", "--diff-filter=U"]);
      await git(o.taskWorktree, ["merge", "--abort"]);
      const why = firstLine(merge.stdout || merge.stderr);
      if (unmerged.stdout.trim() !== "") {
        throw new IpcFailure(
          "merge-conflict",
          `${chosen.branch} conflicts with the task branch; nothing was merged. ${why}`,
        );
      }
      throw new IpcFailure(
        "merge-failed",
        `${chosen.branch} could not be merged into the task branch; nothing was merged. ${why}`,
      );
    }
    const problems = await this.discardAll(taskId, o.repo, n);
    const worktree = await git(o.repo, ["worktree", "remove", "--force", chosen.worktree]);
    if (worktree.code !== 0)
      problems.push(`kept builder's worktree: ${firstLine(worktree.stderr)}`);
    else await git(o.repo, ["branch", "-D", chosen.branch]);
    this.setStatus(taskId, chosen.stage_idx, n, "kept");
    return problems;
  }

  /** The builders of a task with their check results against the task branch. */
  async variants(taskId: string, taskBranch: string | null, repo: string): Promise<TaskVariant[]> {
    const out: TaskVariant[] = [];
    for (const v of this.rows(taskId)) {
      let commits = 0;
      let files: string[] = [];
      let additions = 0;
      let deletions = 0;
      if (taskBranch && (v.status === "done" || v.status === "failed")) {
        const count = await git(repo, ["rev-list", "--count", `${taskBranch}..${v.branch}`]);
        commits = Number(count.stdout.trim()) || 0;
        const names = await git(repo, ["diff", "--name-only", `${taskBranch}...${v.branch}`]);
        files = names.stdout.split("\n").filter(Boolean);
        const stat = await git(repo, ["diff", "--numstat", `${taskBranch}...${v.branch}`]);
        for (const line of stat.stdout.split("\n").filter(Boolean)) {
          const [a, d] = line.split("\t");
          additions += Number(a) || 0;
          deletions += Number(d) || 0;
        }
      }
      out.push({
        n: v.n,
        branch: v.branch,
        worktree: v.worktree,
        status: v.status,
        error: v.error,
        commits,
        files,
        additions,
        deletions,
      });
    }
    return out;
  }
}
