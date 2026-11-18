import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TaskDetail, TaskStageView, TaskStatus, TaskView } from "../../../shared/models";
import type { Role, Workspace } from "../../../shared/types";
import type { Bus } from "../../core/bus";
import type { Db } from "../../core/db";
import { IpcFailure } from "../../core/ipc";
import type { Notifier } from "../../core/notifier";
import { writeTextFile } from "../../core/settings";
import { nowIso } from "../../core/util";
import { git } from "../git/run";
import { createWorktree } from "../git/worktrees";
import type { RunService } from "../runs/service";
import { FanOut } from "./fanout";
import { fileArtTask } from "./file-art";
import { integrateTask } from "./integrate";
import { renderTemplate } from "./templates";

export interface TaskEngineDeps {
  db: Db;
  bus: Bus;
  runs: RunService;
  notifier: Notifier;
  workspace: () => Workspace | null;
  /** Absolute code folder of a project. */
  projectPath: (projectId: string) => string | undefined;
  /** Resolves a role id for a project, honouring its overrides. */
  resolveRole: (roleId: string, projectId: string) => Role;
  tasksDir: string;
  /** The Art vault folder from the settings (empty when not set). */
  artVaultRoot: () => string;
  /** Appends a dated line to the project's "Implementation notes" through the vault writer. */
  recordNote: (projectId: string, text: string) => Promise<void>;
}

interface TaskRow {
  id: string;
  project_id: string;
  pipeline: string;
  title: string;
  description: string;
  branch: string | null;
  worktree: string | null;
  /** The branch the project was on when the worktree was made, where the task is merged at the end. */
  base_branch: string | null;
  stage_index: number;
  fanout: number;
  recorded_at: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

interface StageRow {
  task_id: string;
  idx: number;
  stage_id: string;
  role: string;
  status: TaskStageView["status"];
  run_id: string | null;
  session_id: string | null;
  output_path: string | null;
  approved_at: string | null;
}

const slash = (p: string): string => p.replace(/\\/g, "/");
const MAX_OUTPUT_BYTES = 200_000;

/**
 * Runs a pipeline for a task: each stage is a headless run with its role, its output is a file the next
 * stage reads, and a gate stops the task until the owner approves or rejects. State lives in the
 * database, so a restart picks up where it left off.
 */
export class TaskEngine {
  private readonly starts = new Map<string, string>();
  private readonly lastError = new Map<string, string>();
  private readonly fanout: FanOut;

  constructor(private readonly deps: TaskEngineDeps) {
    this.fanout = new FanOut({ db: deps.db, runs: deps.runs, changed: (id) => this.changed(id) });
    this.recover();
  }

  // ---------- persistence ----------

  private task(id: string): TaskRow {
    const row = this.deps.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      TaskRow | undefined;
    if (!row) throw new IpcFailure("not-found", `No task ${id}`);
    return row;
  }

  private stages(id: string): StageRow[] {
    return this.deps.db
      .prepare("SELECT * FROM task_stages WHERE task_id = ? ORDER BY idx")
      .all(id) as StageRow[];
  }

  private setTask(
    id: string,
    patch: Partial<Pick<TaskRow, "status" | "stage_index" | "branch" | "worktree" | "base_branch">>,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    this.deps.db
      .prepare(`UPDATE tasks SET ${sets}${sets ? ", " : ""}updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => patch[k] ?? null), nowIso(), id);
    this.changed(id);
  }

  private setStage(
    id: string,
    idx: number,
    patch: Partial<Pick<StageRow, "status" | "run_id" | "output_path" | "approved_at">>,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    this.deps.db
      .prepare(
        `UPDATE task_stages SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE task_id = ? AND idx = ?`,
      )
      .run(...keys.map((k) => patch[k] ?? null), id, idx);
    this.changed(id);
  }

  private changed(id: string): void {
    const projectId = (
      this.deps.db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(id) as
        { project_id: string } | undefined
    )?.project_id;
    this.deps.bus.emit("task.changed", { id }, projectId);
  }

  /** After a restart: a stage that was running did not finish, so it is failed and can be retried. */
  private recover(): void {
    const running = this.deps.db
      .prepare("SELECT * FROM tasks WHERE status = 'running'")
      .all() as TaskRow[];
    for (const t of running) {
      this.deps.db
        .prepare(
          "UPDATE task_stages SET status = 'failed' WHERE task_id = ? AND idx = ? AND status IN ('running','pending')",
        )
        .run(t.id, t.stage_index);
      this.deps.db
        .prepare(
          "UPDATE task_variants SET status = 'failed', error = 'interrupted' WHERE task_id = ? AND status = 'running'",
        )
        .run(t.id);
      this.lastError.set(`${t.id}:${t.stage_index}`, "interrupted");
      this.deps.db
        .prepare("UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(nowIso(), t.id);
    }
  }

  // ---------- queries ----------

  /** The provider a role resolves to for a project, or null when the role is missing. */
  private providerOf(roleId: string, projectId: string): string | null {
    try {
      return this.deps.resolveRole(roleId, projectId).provider;
    } catch {
      return null;
    }
  }

  private view(t: TaskRow): TaskView {
    const ws = this.deps.workspace();
    const project = ws?.projects.find((p) => p.id === t.project_id);
    const pipeline = ws?.pipelines[t.pipeline];
    const rows = this.stages(t.id);
    return {
      id: t.id,
      projectId: t.project_id,
      projectName: project?.name ?? t.project_id,
      pipeline: t.pipeline,
      pipelineName: pipeline?.name ?? t.pipeline,
      title: t.title,
      description: t.description,
      branch: t.branch,
      worktree: t.worktree,
      stageIndex: t.stage_index,
      fanout: t.fanout,
      recorded: t.recorded_at !== null,
      status: t.status,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      stages: rows.map((r) => {
        const def = pipeline?.stages[r.idx];
        const provider = this.providerOf(r.role, t.project_id);
        return {
          idx: r.idx,
          stageId: r.stage_id,
          role: r.role,
          provider,
          gate: def?.gate ?? false,
          worktree: def?.worktree ?? false,
          status: r.status,
          runId: r.run_id,
          outputPath: r.output_path,
          approvedAt: r.approved_at,
          startedAt: this.starts.get(`${t.id}:${r.idx}`) ?? null,
          error: r.status === "failed" ? (this.lastError.get(`${t.id}:${r.idx}`) ?? null) : null,
        };
      }),
    };
  }

  list(projectId?: string): TaskView[] {
    const rows = this.deps.db
      .prepare(
        `SELECT * FROM tasks ${projectId ? "WHERE project_id = ?" : ""} ORDER BY created_at DESC`,
      )
      .all(...(projectId ? [projectId] : [])) as TaskRow[];
    return rows.map((r) => this.view(r));
  }

  async get(id: string): Promise<TaskDetail> {
    const row = this.task(id);
    const view = this.view(row);
    const outputs: Record<string, string> = {};
    for (const s of view.stages) {
      if (s.outputPath && existsSync(s.outputPath)) {
        outputs[s.stageId] = readFileSync(s.outputPath, "utf8").slice(0, MAX_OUTPUT_BYTES);
      }
    }
    const repo = this.deps.projectPath(row.project_id);
    const variants = repo ? await this.fanout.variants(id, row.branch, repo) : [];
    return { ...view, outputs, variants };
  }

  // ---------- actions ----------

  create(input: {
    projectId: string;
    pipeline: string;
    title: string;
    description: string;
    fanout?: number;
  }): TaskView {
    const ws = this.deps.workspace();
    const pipeline = ws?.pipelines[input.pipeline];
    if (!pipeline)
      throw new IpcFailure("no-pipeline", `There is no pipeline called "${input.pipeline}"`);
    if (!ws?.projects.some((p) => p.id === input.projectId))
      throw new IpcFailure("not-found", `No project with id ${input.projectId}`);
    if (!this.deps.projectPath(input.projectId))
      throw new IpcFailure("no-folder", "That project has no folder on this machine");
    const id = randomUUID();
    const now = nowIso();
    this.deps.db.transaction(() => {
      this.deps.db
        .prepare(
          `INSERT INTO tasks (id, project_id, pipeline, title, description, branch, worktree, stage_index, fanout, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, 'running', ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.pipeline,
          input.title.trim(),
          input.description,
          Math.min(4, Math.max(1, input.fanout ?? 1)),
          now,
          now,
        );
      pipeline.stages.forEach((s, idx) => {
        this.deps.db
          .prepare(
            "INSERT INTO task_stages (task_id, idx, stage_id, role, status) VALUES (?, ?, ?, ?, 'pending')",
          )
          .run(id, idx, s.id, s.role);
      });
    })();
    mkdirSync(join(this.deps.tasksDir, id), { recursive: true });
    this.changed(id);
    void this.drive(id);
    return this.view(this.task(id));
  }

  /** The owner approves the gate: the task moves on to the next stage. */
  approve(id: string): void {
    const t = this.task(id);
    if (t.status !== "waiting-gate")
      throw new IpcFailure("not-waiting", "This task is not waiting for approval");
    if (this.fanout.awaitingChoice(id)) {
      throw new IpcFailure("pick-one", "Pick one builder's result to keep first");
    }
    this.setStage(id, t.stage_index, { status: "approved", approved_at: nowIso() });
    this.setTask(id, { stage_index: t.stage_index + 1, status: "running" });
    void this.drive(id);
  }

  /** The owner rejects the gate: the same stage runs again with the comment added to its prompt. */
  reject(id: string, comment: string): void {
    const t = this.task(id);
    if (t.status !== "waiting-gate")
      throw new IpcFailure("not-waiting", "This task is not waiting for approval");
    this.setStage(id, t.stage_index, { status: "pending", approved_at: null });
    this.setTask(id, { status: "running" });
    const repo = this.deps.projectPath(t.project_id);
    void (async () => {
      const left =
        repo && this.fanout.awaitingChoice(id) ? await this.fanout.discardAll(id, repo) : [];
      if (left.length > 0) {
        this.fail(
          this.task(id),
          t.stage_index,
          `Could not remove the earlier builders: ${left.join("; ")}`,
        );
        return;
      }
      await this.drive(id, comment.trim());
    })();
  }

  /** Runs the current stage again after a failure or an interruption. */
  retry(id: string): void {
    const t = this.task(id);
    if (t.status !== "failed")
      throw new IpcFailure("not-failed", "Only a failed task can be retried");
    this.setStage(id, t.stage_index, { status: "pending" });
    this.lastError.delete(`${id}:${t.stage_index}`);
    this.setTask(id, { status: "running" });
    void this.drive(id);
  }

  /** Writes a one-line hand-off record of a finished task into the project notes. Only when asked. */
  async record(id: string): Promise<void> {
    const t = this.task(id);
    if (t.status !== "done")
      throw new IpcFailure("not-done", "Only a finished task can be recorded");
    if (t.recorded_at)
      throw new IpcFailure("already-recorded", "This task is already recorded in the notes");
    const ws = this.deps.workspace();
    const stages = this.stages(id)
      .map((s) => s.stage_id)
      .join(", ");
    const name = ws?.pipelines[t.pipeline]?.name ?? t.pipeline;
    const where = t.branch ? ` on ${t.branch}` : "";
    await this.deps.recordNote(
      t.project_id,
      `Task "${t.title}" (${name}) finished${where}; stages: ${stages}.`,
    );
    this.deps.db.prepare("UPDATE tasks SET recorded_at = ? WHERE id = ?").run(nowIso(), id);
    this.changed(id);
  }

  /** Keeps one builder of a fan-out stage: merges it into the task branch and removes the others. */
  async keep(id: string, variant: number): Promise<void> {
    const t = this.task(id);
    const repo = this.deps.projectPath(t.project_id);
    if (t.status !== "waiting-gate" || !this.fanout.awaitingChoice(id) || !repo || !t.worktree) {
      throw new IpcFailure("not-waiting", "This task has no builder results waiting for a choice");
    }
    const left = await this.fanout.keep(id, variant, { repo, taskWorktree: t.worktree });
    if (left.length > 0) {
      this.deps.notifier.notify({
        kind: "agent.failed",
        projectId: t.project_id,
        title: `Builder kept, but some builders were not removed: ${t.title}`,
        body: left.join("; "),
        link: { view: "board" },
      });
    }
    this.setStage(id, t.stage_index, { status: "approved", approved_at: nowIso() });
    this.setTask(id, { stage_index: t.stage_index + 1, status: "running" });
    void this.drive(id);
  }

  cancel(id: string): void {
    const t = this.task(id);
    if (t.status === "done" || t.status === "cancelled") return;
    const stage = this.stages(id).find((s) => s.idx === t.stage_index);
    if (stage?.run_id) this.deps.runs.cancel(stage.run_id);
    this.fanout.cancel(id);
    this.setTask(id, { status: "cancelled" });
  }

  // ---------- the loop ----------

  /** Runs stages one after another until the task waits at a gate, finishes, fails or is cancelled. */
  private async drive(id: string, feedback?: string): Promise<void> {
    let note = feedback;
    for (;;) {
      const t = this.task(id);
      if (t.status !== "running") return;
      const pipeline = this.deps.workspace()?.pipelines[t.pipeline];
      if (!pipeline || t.stage_index >= pipeline.stages.length) {
        const note = await this.finish(t);
        this.setTask(id, { status: "done" });
        this.deps.notifier.notify({
          kind: "task.done",
          projectId: t.project_id,
          title: `Task finished: ${t.title}`,
          ...(note ? { body: note } : {}),
          link: { view: "board" },
        });
        return;
      }
      const outcome = await this.runStage(t, t.stage_index, note);
      note = undefined;
      if (outcome !== "continue") return;
      this.setTask(id, { stage_index: t.stage_index + 1 });
    }
  }

  /** What happens after the final approval: a Feature task is merged, an Art request is filed. */
  private async finish(t: TaskRow): Promise<string | null> {
    const notes: Array<string | null> = [await this.integrate(t)];
    if (t.pipeline === "art") {
      const project = this.deps.workspace()?.projects.find((p) => p.id === t.project_id);
      notes.push(
        fileArtTask({
          artVaultRoot: this.deps.artVaultRoot(),
          projectName: project?.name ?? t.project_id,
          title: t.title,
          taskId: t.id,
          taskFolder: join(this.deps.tasksDir, t.id),
        }).note,
      );
    }
    const text = notes.filter(Boolean).join(" ");
    return text === "" ? null : text;
  }

  /** After the final approval: merge the task branch and remove its worktree. Returns a note when something was left. */
  private async integrate(t: TaskRow): Promise<string | null> {
    const repo = this.deps.projectPath(t.project_id);
    if (!repo || !t.worktree || !t.branch) return null;
    const result = await integrateTask({
      repo,
      branch: t.branch,
      worktree: t.worktree,
      baseBranch: t.base_branch,
      title: t.title,
    });
    if (result.merged && !result.note) this.setTask(t.id, { worktree: null });
    return result.note;
  }

  private fail(t: TaskRow, idx: number, message: string): "stop" {
    this.lastError.set(`${t.id}:${idx}`, message);
    this.setStage(t.id, idx, { status: "failed" });
    if (this.task(t.id).status === "running") this.setTask(t.id, { status: "failed" });
    this.deps.notifier.notify({
      kind: "agent.failed",
      projectId: t.project_id,
      title: `Task stage failed: ${t.title}`,
      body: message,
      link: { view: "board" },
    });
    return "stop";
  }

  /** The build stage with several builders: they run in parallel, then the owner picks one result. */
  private async runFanout(
    t: TaskRow,
    idx: number,
    o: { current: TaskRow; repo: string; role: Role; prompt: string; outputPath: string },
  ): Promise<"continue" | "stop"> {
    if (this.fanout.rows(t.id).length > 0) {
      const left = await this.fanout.discardAll(t.id, o.repo);
      if (left.length > 0)
        return this.fail(t, idx, `Could not remove the earlier builders: ${left.join("; ")}`);
    }
    this.deps.db.prepare("DELETE FROM task_variants WHERE task_id = ?").run(t.id);
    const succeeded = await this.fanout.run({
      taskId: t.id,
      stageIdx: idx,
      count: o.current.fanout,
      repo: o.repo,
      taskBranch: o.current.branch as string,
      slug: `${o.current.title} ${t.id.slice(0, 4)}`,
      role: o.role,
      projectId: t.project_id,
      prompt: o.prompt,
      providerId: o.role.provider,
    });
    if (this.task(t.id).status === "cancelled") return "stop";
    if (succeeded === 0) return this.fail(t, idx, "Every builder failed");
    writeTextFile(
      o.outputPath,
      `# Builders for ${o.current.title}

${succeeded} of ${o.current.fanout} builders finished. Pick one result to keep.
`,
    );
    this.setStage(t.id, idx, { output_path: o.outputPath, status: "waiting-gate" });
    this.setTask(t.id, { status: "waiting-gate" });
    this.deps.notifier.notify({
      kind: "task.gate",
      projectId: t.project_id,
      title: `Pick a builder result for ${o.current.title}`,
      body: `${succeeded} of ${o.current.fanout} builders finished`,
      link: { view: "board" },
    });
    return "stop";
  }

  private async runStage(t: TaskRow, idx: number, feedback?: string): Promise<"continue" | "stop"> {
    const ws = this.deps.workspace();
    const stage = ws?.pipelines[t.pipeline]?.stages[idx];
    if (!ws || !stage) return this.fail(t, idx, "The pipeline no longer has this stage");
    this.starts.set(`${t.id}:${idx}`, nowIso());
    this.setStage(t.id, idx, { status: "running" });
    try {
      const role = this.deps.resolveRole(stage.role, t.project_id);
      const repo = this.deps.projectPath(t.project_id);
      if (!repo) return this.fail(t, idx, "The project folder is missing");
      let current = this.task(t.id);
      if (stage.worktree && !current.worktree) {
        const head = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
        const made = await createWorktree(repo, `${current.title} ${t.id.slice(0, 4)}`);
        this.setTask(t.id, {
          branch: made.branch,
          worktree: made.path,
          base_branch: head && head !== "HEAD" ? head : null,
        });
        current = this.task(t.id);
      }
      const outputPath = slash(resolve(this.deps.tasksDir, t.id, `${stage.id}.md`));
      const stagesCtx: Record<string, { outputPath: string }> = {};
      for (const s of this.stages(t.id))
        stagesCtx[s.stage_id] = {
          outputPath: slash(resolve(this.deps.tasksDir, t.id, `${s.stage_id}.md`)),
        };
      let prompt = renderTemplate(stage.prompt, {
        task: {
          id: t.id,
          title: current.title,
          description: current.description,
          branch: current.branch,
          worktree: current.worktree,
          project: t.project_id,
        },
        stage: { id: stage.id, outputPath },
        stages: stagesCtx,
      });
      if (feedback)
        prompt += `\n\nThe owner rejected the previous attempt with this feedback. Address it:\n${feedback}`;

      if (stage.worktree && current.fanout > 1 && current.branch) {
        return this.runFanout(t, idx, { current, repo, role, prompt, outputPath });
      }
      const handle = this.deps.runs.start({
        kind: "stage",
        providerId: role.provider,
        role,
        cwd: current.worktree ?? repo,
        prompt,
        projectId: t.project_id,
        taskId: t.id,
      });
      this.setStage(t.id, idx, { run_id: handle.id });
      const result = await handle.result;
      if (this.task(t.id).status === "cancelled") return "stop";
      if (!result.ok) return this.fail(t, idx, result.error ?? "The run failed");
      // The output file is how the next stage reads this one: write the answer if the agent did not.
      if (!existsSync(outputPath)) writeTextFile(outputPath, `${result.resultText}\n`);
      this.setStage(t.id, idx, { output_path: outputPath });
      if (stage.gate) {
        this.setStage(t.id, idx, { status: "waiting-gate" });
        this.setTask(t.id, { status: "waiting-gate" });
        this.deps.notifier.notify({
          kind: "task.gate",
          projectId: t.project_id,
          title: `Approve "${stage.id}" for ${t.title}`,
          body: `${current.title}: the ${stage.id} stage is done and waits for you`,
          link: { view: "board" },
        });
        return "stop";
      }
      this.setStage(t.id, idx, { status: "done" });
      return "continue";
    } catch (err) {
      return this.fail(t, idx, (err as Error).message);
    }
  }
}
