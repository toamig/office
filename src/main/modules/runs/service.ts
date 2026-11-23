import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { applyAutonomy, effectiveAutonomy } from "../../../shared/autonomy";
import type { BackgroundRun } from "../../../shared/models";
import type { Role } from "../../../shared/types";
import type { Bus } from "../../core/bus";
import type { Db } from "../../core/db";
import { IpcFailure } from "../../core/ipc";
import { writeTextFile } from "../../core/settings";
import { nowIso } from "../../core/util";
import type { ProviderRegistry } from "../providers/registry";
import type { AgentEvent, AgentRun, AgentRunResult, RunPermission } from "../providers/types";
import type { PermissionBroker } from "./permissions";
import type { BrainScope } from "../vault/scope";

export type RunKind = "ask" | "brief" | "stage" | "capture" | "explore-summary" | "automation" | "recorder" | "route" | "workflow";

export interface RunRequest {
  kind: RunKind;
  title?: string;
  providerId: string;
  role?: Role;
  cwd: string;
  prompt: string;
  resumeId?: string;
  /** Only these tools exist for the run, and nothing else may run ("Read,Grep,Glob"). */
  tools?: string;
  brain?: BrainScope;
  addDirs?: string[];
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
  fullAutoConfirmed?: () => boolean;
  /**
   * What a builder stage needs to ask the owner. Without it, a writable run gets only its allowed commands
   * and anything else is refused.
   */
  permissions?: {
    broker: PermissionBroker;
    /** Writes the run's MCP config (serving office_permission) into its folder; returns the file path. */
    writeMcpConfig: (runId: string, dir: string) => string;
  };
}

/** Runs that only read: they get read tools and nothing ever asks. */
const READ_ONLY_KINDS: RunKind[] = ["ask", "brief", "capture", "explore-summary", "recorder", "route"];

const TITLES: Record<RunKind, string> = {
  ask: "Ask Brain", brief: "Morning brief", stage: "Builder", capture: "Session capture",
  "explore-summary": "Chat summary", automation: "Automation", recorder: "Recorder", route: "Request routing", workflow: "Workflow",
};

function runTitle(kind: string): string {
  return Object.hasOwn(TITLES, kind) ? TITLES[kind as RunKind] : kind;
}

/** Runs headless agent tasks and records each one: a database row plus events.jsonl and result.md. */
export class RunService {
  private readonly active = new Map<string, { run: AgentRun; info: BackgroundRun }>();

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
    const title = req.title || runTitle(req.kind);
    const startedAt = nowIso();
    const role = req.kind === "stage" && req.role?.autonomy
      ? applyAutonomy(req.role, effectiveAutonomy(req.role.autonomy, this.deps.fullAutoConfirmed?.() === true))
      : req.role;
    const permission = this.permissionFor({ ...req, ...(role ? { role } : {}) }, id, dir);
    mkdirSync(dir, { recursive: true });
    this.deps.db
      .prepare(
        `INSERT INTO runs (id, kind, provider, model, project_id, task_id, status, started_at, output_path, title)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        id,
        req.kind,
        req.providerId,
        req.role?.model ?? null,
        req.projectId ?? null,
        req.taskId ?? null,
        startedAt,
        join(dir, "result.md"),
        title,
      );

    const run = provider.headless({
      permission,
      cwd: req.cwd,
      prompt: req.prompt,
      officeSessionId: id,
      runDir: dir,
      ...(role ? { role } : {}),
      ...(req.resumeId ? { resumeId: req.resumeId } : {}),
      ...(req.tools === undefined ? {} : { tools: req.tools }),
      ...(req.brain ? { brain: req.brain } : {}),
      ...(req.addDirs ? { addDirs: req.addDirs } : {}),
    });
    const info: BackgroundRun = { id, title, startedAt, endedAt: null, status: "running" };
    const active = { run, info };
    this.active.set(id, active);
    this.deps.bus.emit("run.started", { runId: id, kind: req.kind }, req.projectId);

    const log = join(dir, "events.jsonl");
    const recorded = (async () => {
      for await (const event of run.events) {
        appendFileSync(log, `${JSON.stringify(event)}\n`);
        req.onEvent?.(event);
        this.deps.bus.emit("run.progress", { runId: id, kind: req.kind, event }, req.projectId);
      }
    })().catch(() => undefined);

    const result = run.done.then(async (done) => {
      await recorded;
      const cancelled = active.info.status === "stopping" || done.error === "cancelled";
      const outcome = cancelled ? { ...done, ok: false, error: "cancelled" } : done;
      this.active.delete(id);
      this.deps.permissions?.broker.cancelRun(id);
      writeTextFile(join(dir, "result.md"), `${outcome.resultText}\n`);
      this.deps.db
        .prepare("UPDATE runs SET status = ?, ended_at = ?, error = ? WHERE id = ?")
        .run(
          outcome.ok ? "done" : cancelled ? "cancelled" : "failed",
          nowIso(),
          outcome.error ?? null,
          id,
        );
      this.deps.bus.emit("run.done", { runId: id, kind: req.kind, ok: outcome.ok, cancelled }, req.projectId);
      return { ...outcome, id };
    });
    return { id, dir, run, result };
  }

  /**
   * Who answers "may I run this?" for a run (spec 6.3): read-only runs and roles get read tools only;
   * a writable stage asks the owner; a writable automation is limited to its allowed commands.
   */
  private permissionFor(req: RunRequest, id: string, dir: string): RunPermission {
    if (!req.role || req.role.readOnly || READ_ONLY_KINDS.includes(req.kind)) {
      return { kind: "readonly" };
    }
    const permissions = this.deps.permissions;
    if ((req.kind === "stage" || req.kind === "workflow") && req.role.autonomy === "full-auto") return { kind: "full" };
    if (req.kind === "stage" && permissions) {
      return { kind: "ask", mcpConfig: permissions.writeMcpConfig(id, dir) };
    }
    return { kind: "allowlist" };
  }

  cancel(id: string): void {
    const active = this.active.get(id);
    if (active?.info.status === "running") {
      active.info.status = "stopping";
      active.run.cancel();
      this.deps.bus.emit("run.stopping", { runId: id });
    }
    this.deps.permissions?.broker.cancelRun(id);
  }

  background(includeStopped: boolean): BackgroundRun[] {
    const active = [...this.active.values()].map(({ info }) => info).reverse();
    if (!includeStopped) return active;
    const stopped = this.deps.db.prepare(`SELECT id, kind, title, started_at AS startedAt, ended_at AS endedAt
      FROM runs WHERE status = 'cancelled' ORDER BY ended_at DESC LIMIT 10`).all() as Array<{
        id: string; kind: string; title: string | null; startedAt: string; endedAt: string | null;
      }>;
    return [...active, ...stopped.map(({ kind, title, ...row }): BackgroundRun => ({
      ...row, title: title ?? runTitle(kind), status: "stopped",
    }))];
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
