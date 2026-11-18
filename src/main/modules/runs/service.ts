import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "../../../shared/types";
import type { Bus } from "../../core/bus";
import type { Db } from "../../core/db";
import { IpcFailure } from "../../core/ipc";
import { writeTextFile } from "../../core/settings";
import { nowIso } from "../../core/util";
import type { ProviderRegistry } from "../providers/registry";
import type { AgentEvent, AgentRun, AgentRunResult } from "../providers/types";

export type RunKind = "ask" | "brief" | "stage" | "capture" | "explore-summary" | "automation";

export interface RunRequest {
  kind: RunKind;
  providerId: string;
  role?: Role;
  cwd: string;
  prompt: string;
  resumeId?: string;
  projectId?: string;
  taskId?: string;
  /** Called for each normalised event while the run is going (the Ask panel streams from this). */
  onEvent?: (event: AgentEvent) => void;
}

export interface RunHandle {
  id: string;
  dir: string;
  run: AgentRun;
  /** Resolves when the run ended and its row and files are written. */
  result: Promise<AgentRunResult & { id: string }>;
}

export interface RunServiceDeps {
  db: Db;
  bus: Bus;
  providers: ProviderRegistry;
  runsDir: string;
}

/** Runs headless agent tasks and records each one: a database row plus events.jsonl and result.md. */
export class RunService {
  private readonly active = new Map<string, AgentRun>();

  constructor(private readonly deps: RunServiceDeps) {
    // A run that was going when the app closed did not finish.
    deps.db
      .prepare(
        "UPDATE runs SET status = 'failed', ended_at = ?, error = 'interrupted' WHERE status = 'running'",
      )
      .run(nowIso());
  }

  start(req: RunRequest): RunHandle {
    const provider = this.deps.providers.get(req.providerId);
    if (!provider) throw new IpcFailure("no-provider", `Unknown provider "${req.providerId}"`);
    const id = randomUUID();
    const dir = join(this.deps.runsDir, id);
    mkdirSync(dir, { recursive: true });
    this.deps.db
      .prepare(
        `INSERT INTO runs (id, kind, provider, model, project_id, task_id, status, started_at, output_path)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
      )
      .run(
        id,
        req.kind,
        req.providerId,
        req.role?.model ?? null,
        req.projectId ?? null,
        req.taskId ?? null,
        nowIso(),
        join(dir, "result.md"),
      );

    const run = provider.headless({
      cwd: req.cwd,
      prompt: req.prompt,
      officeSessionId: id,
      runDir: dir,
      ...(req.role ? { role: req.role } : {}),
      ...(req.resumeId ? { resumeId: req.resumeId } : {}),
    });
    this.active.set(id, run);

    const log = join(dir, "events.jsonl");
    void (async () => {
      for await (const event of run.events) {
        appendFileSync(log, `${JSON.stringify(event)}\n`);
        req.onEvent?.(event);
        this.deps.bus.emit("run.progress", { runId: id, kind: req.kind, event }, req.projectId);
      }
    })().catch(() => undefined);

    const result = run.done.then((done) => {
      this.active.delete(id);
      writeTextFile(join(dir, "result.md"), `${done.resultText}\n`);
      const cancelled = done.error === "cancelled";
      this.deps.db
        .prepare("UPDATE runs SET status = ?, ended_at = ?, error = ? WHERE id = ?")
        .run(
          done.ok ? "done" : cancelled ? "cancelled" : "failed",
          nowIso(),
          done.error ?? null,
          id,
        );
      this.deps.bus.emit("run.done", { runId: id, kind: req.kind, ok: done.ok }, req.projectId);
      return { ...done, id };
    });
    return { id, dir, run, result };
  }

  cancel(id: string): void {
    this.active.get(id)?.cancel();
  }

  /** Recent runs, newest first, optionally of one kind. */
  list(kind?: RunKind): Array<{
    id: string;
    kind: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    projectId: string | null;
    error: string | null;
  }> {
    const rows = this.deps.db
      .prepare(
        `SELECT id, kind, status, started_at, ended_at, project_id, error FROM runs
         ${kind ? "WHERE kind = ?" : ""} ORDER BY started_at DESC LIMIT 200`,
      )
      .all(...(kind ? [kind] : [])) as Array<{
      id: string;
      kind: string;
      status: string;
      started_at: string;
      ended_at: string | null;
      project_id: string | null;
      error: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      projectId: r.project_id,
      error: r.error,
    }));
  }
}
