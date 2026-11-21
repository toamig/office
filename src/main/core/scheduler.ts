import { randomUUID } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import { WorkflowRunStatus, workflowsFor, type Workflow, type WorkflowView } from "../../shared/workflow";
import type { Workspace } from "../../shared/types";
import type { Db } from "./db";
import type { Notifier } from "./notifier";
import type { RunRequest, RunService } from "../modules/runs/service";
import { brainScope, type BrainScope } from "../modules/vault/scope";

export interface SchedulerDeps {
  db: Db;
  runs: RunService;
  notifier: Notifier;
  workspace: () => Workspace | null;
  root: () => string;
  neutralFolder: () => string;
  projectPath: (projectId: string) => string | undefined;
  defaultProvider: () => string;
  output: (root: string, workflow: Workflow, text: string) => Promise<void>;
  changed?: () => void;
  now?: () => Date;
}

function nextRunOf(pattern: string, from: Date): Date | null {
  try {
    return new Cron(pattern, { paused: true }).nextRun(from);
  } catch {
    return null;
  }
}

export function validCron(pattern: string): boolean {
  try {
    new Cron(pattern, { paused: true });
    return true;
  } catch {
    return false;
  }
}

export const cheapestModel = (provider: string): string =>
  provider === "codex" ? "gpt-5.4-mini" : "haiku";

function historicalResult(path: string | null): string | null {
  if (!path) return null;
  try {
    const file = openSync(path, "r");
    try {
      const preview = Buffer.alloc(4096);
      return preview.subarray(0, readSync(file, preview)).toString("utf8").trim() || null;
    } finally {
      closeSync(file);
    }
  } catch {
    return null;
  }
}

/** Resolves the working directory and read scope before asking the agent to run. */
export function workflowRequest(
  workflow: Workflow,
  ws: Workspace | null,
  root: string,
  project: string | undefined,
  neutralFolder: string,
  provider: string,
): RunRequest {
  if (workflow.projectId && !project) throw new Error("The workflow project is unavailable on this machine.");
  const canReadProject = workflow.read === "project" || workflow.read === "both";
  const canReadBrain = workflow.read === "brain" || workflow.read === "both";
  if (canReadProject && !project) throw new Error("Choose a project for this workflow's read scope.");
  if (canReadBrain && (!root || ws?.vault.kind === "none")) throw new Error("The workflow has no Brain to read.");
  const cwd = canReadProject ? project! : canReadBrain ? root : neutralFolder;
  const brain: BrainScope | undefined = canReadBrain ? brainScope(ws, root, workflow.projectId ?? undefined) : undefined;
  const readScope: BrainScope | undefined = brain ? {
    ...brain,
    writable: [],
    readOnly: [...brain.readOnly, ...brain.writable],
    private: [...brain.private, join(root, ".git")],
    restrictedRead: true,
    instructions: "Use the Brain routers and read only the notes that answer this workflow. Private notes are available only to their own project. Use file tools to read.",
  } : canReadProject ? {
    root: cwd, writable: [], readOnly: [], private: root && root !== cwd ? [root] : [],
    instructions: "Read only files in this project.", restrictedRead: true,
  } : undefined;
  const output = workflow.output === "worth-a-look"
    ? 'Return JSON {"ideas":[{"title":"Short idea","detail":"What makes it useful and where to begin"}]}. Return up to five ideas.'
    : "Return the result as concise Markdown.";
  return {
    kind: "workflow",
    providerId: provider,
    cwd,
    prompt: `${workflow.prompt}\n\n${output}`,
    tools: workflow.read === "none" ? "" : "Read,Grep,Glob,WebSearch",
    role: { provider, model: workflow.model || cheapestModel(provider), instructions: "", readOnly: true, allowedCommands: [] },
    ...(workflow.projectId ? { projectId: workflow.projectId } : {}),
    ...(readScope ? { brain: readScope } : {}),
    ...(canReadBrain && canReadProject ? { addDirs: [root] } : {}),
  };
}

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: SchedulerDeps) {
    deps.db.prepare("UPDATE automations_log SET status = 'failed', result = 'Interrupted' WHERE status = 'running'").run();
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private lastMark(root: string, id: string): string | null {
    const row = this.deps.db.prepare(`SELECT MAX(fired_at) AS at FROM automations_log
      WHERE workspace = ? AND automation = ?`)
      .get(root, id) as { at: string | null };
    return row.at;
  }

  private mark(root: string, id: string, at: Date, status?: "running"): string {
    const key = randomUUID();
    this.deps.db.prepare("INSERT INTO automations_log (id, automation, fired_at, workspace, status) VALUES (?, ?, ?, ?, ?)")
      .run(key, id, at.toISOString(), root, status ?? null);
    return key;
  }

  private latestRun(root: string, id: string): Pick<WorkflowView, "lastRun" | "lastFiredAt"> {
    const row = this.deps.db.prepare(`SELECT l.fired_at AS at, l.status, l.result,
      r.status AS agentStatus, r.error, r.output_path AS outputPath
      FROM automations_log l LEFT JOIN runs r ON r.id = l.run_id
      WHERE l.workspace = ? AND l.automation = ? AND (l.status IS NOT NULL OR l.run_id IS NOT NULL)
      ORDER BY l.fired_at DESC, l.rowid DESC LIMIT 1`).get(root, id) as {
        at: string; status: string | null; result: string | null; agentStatus: string | null;
        error: string | null; outputPath: string | null;
      } | undefined;
    if (!row) return { lastFiredAt: null, lastRun: null };
    const status = WorkflowRunStatus.safeParse(row.status ?? row.agentStatus);
    return {
      lastFiredAt: row.at,
      lastRun: status.success ? {
        status: status.data, result: row.result ?? row.error ?? (row.status === null ? historicalResult(row.outputPath) : null),
      } : null,
    };
  }

  list(): WorkflowView[] {
    const root = this.deps.root();
    return workflowsFor(this.deps.workspace()).map((workflow) => ({
      ...workflow,
      valid: workflow.schedule === null || validCron(workflow.schedule),
      ...this.latestRun(root, workflow.id),
      nextRun: workflow.enabled && workflow.schedule ? nextRunOf(workflow.schedule, this.now())?.toISOString() ?? null : null,
    }));
  }

  tick(): void {
    const root = this.deps.root();
    if (!root) return;
    const now = this.now();
    for (const workflow of workflowsFor(this.deps.workspace())) {
      if (!workflow.schedule || this.inFlight.has(`${root}\0${workflow.id}`)) continue;
      const last = this.lastMark(root, workflow.id);
      if (!last) {
        this.mark(root, workflow.id, now);
        continue;
      }
      const due = nextRunOf(workflow.schedule, new Date(last));
      if (!due || due > now) continue;
      if (workflow.enabled) void this.fire(workflow.id, now).catch(() => undefined);
      else this.mark(root, workflow.id, now);
    }
  }

  async fire(id: string, at = this.now()): Promise<string | null> {
    const root = this.deps.root();
    const ws = this.deps.workspace();
    const workflow = workflowsFor(ws).find((entry) => entry.id === id);
    if (!workflow) throw new Error("That workflow no longer exists.");
    if (!workflow.enabled) throw new Error("Enable this workflow before running it.");
    const key = `${root}\0${id}`;
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);
    let logId: string | undefined;
    let cancelled = false;
    try {
      logId = this.mark(root, id, at, "running");
      this.deps.changed?.();
      const project = workflow.projectId ? this.deps.projectPath(workflow.projectId) : undefined;
      const request = workflowRequest(workflow, ws, root, project, this.deps.neutralFolder(),
        workflow.provider || this.deps.defaultProvider());
      const handle = this.deps.runs.start(request);
      this.deps.db.prepare("UPDATE automations_log SET run_id = ? WHERE id = ?").run(handle.id, logId);
      const result = await handle.result;
      cancelled = result.error === "cancelled";
      if (!result.ok) throw new Error(result.error ?? "The agent run failed.");
      if (this.deps.root() === root) await this.deps.output(root, workflow, result.resultText);
      this.finish(logId, "done", result.resultText);
      return handle.id;
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      if (logId) this.finish(logId, cancelled ? "cancelled" : "failed", description);
      this.deps.notifier.notify({
        kind: "automation.done",
        ...(workflow.projectId ? { projectId: workflow.projectId } : {}),
        title: `${workflow.name} could not run`,
        body: description,
        link: { view: "workflows" },
      });
      throw error;
    } finally {
      this.inFlight.delete(key);
      this.deps.changed?.();
    }
  }

  private finish(id: string, status: "done" | "failed" | "cancelled", result: string): void {
    const text = result.trim();
    const preview = text.length > 2400 ? `${text.slice(0, 2399)}…` : text;
    this.deps.db.prepare("UPDATE automations_log SET status = ?, result = ? WHERE id = ?")
      .run(status, preview || null, id);
  }

  start(): void {
    this.stop();
    const root = this.deps.root();
    if (root) this.deps.db.prepare("UPDATE automations_log SET workspace = ? WHERE workspace = ''").run(root);
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
