import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type { AutomationView } from "../../shared/models";
import type { Automation, Role, Workspace } from "../../shared/types";
import type { Db } from "./db";
import type { Notifier } from "./notifier";
import type { RunService } from "../modules/runs/service";

export interface SchedulerDeps {
  db: Db;
  runs: RunService;
  notifier: Notifier;
  workspace: () => Workspace | null;
  projectPath: (projectId: string) => string | undefined;
  resolveRole: (roleId: string, projectId: string) => Role;
  /** The clock. Tests pass a fake one. */
  now?: () => Date;
}

/** The next planned run after `from`, as an ISO string, or null when the expression is invalid. */
function nextRunOf(pattern: string, from: Date): string | null {
  try {
    return new Cron(pattern, { paused: true }).nextRun(from)?.toISOString() ?? null;
  } catch {
    return null;
  }
}

/** True when `pattern` is a cron expression croner accepts. */
export function validCron(pattern: string): boolean {
  try {
    new Cron(pattern, { paused: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the automations of the workspace config: scheduled prompts on a project. A slot that passed while
 * the app was closed fires once at the next tick; a slot never fires twice.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: SchedulerDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** The last time the automation fired, or when it was first seen (the baseline for catching up). */
  private lastMark(automationId: string): Date | null {
    const row = this.deps.db
      .prepare("SELECT MAX(fired_at) AS at FROM automations_log WHERE automation = ?")
      .get(automationId) as { at: string | null };
    return row.at ? new Date(row.at) : null;
  }

  private mark(automationId: string, runId: string | null, at: Date): void {
    this.deps.db
      .prepare("INSERT INTO automations_log (id, automation, run_id, fired_at) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), automationId, runId, at.toISOString());
  }

  /** The automations with their last run and next planned run. */
  list(): AutomationView[] {
    const ws = this.deps.workspace();
    return (ws?.automations ?? []).map((a) => {
      const last = this.deps.db
        .prepare(
          "SELECT MAX(fired_at) AS at FROM automations_log WHERE automation = ? AND run_id IS NOT NULL",
        )
        .get(a.id) as { at: string | null };
      const next = nextRunOf(a.cron, this.now());
      return { ...a, valid: validCron(a.cron), lastFiredAt: last.at, nextRun: next };
    });
  }

  /** Looks at every enabled automation and fires the ones whose slot has passed since the last mark. */
  tick(): void {
    const now = this.now();
    for (const automation of this.deps.workspace()?.automations ?? []) {
      if (!automation.enabled || this.inFlight.has(automation.id)) continue;
      let due: Date | null;
      try {
        const last = this.lastMark(automation.id);
        if (!last) {
          this.mark(automation.id, null, now); // first sight: the baseline, not a run
          continue;
        }
        due = new Cron(automation.cron, { paused: true }).nextRun(last);
      } catch {
        continue; // an invalid cron expression never fires
      }
      if (due && due <= now) void this.fire(automation, now);
    }
  }

  /** Fires one automation now (a due slot, or the owner's "run now"). */
  async fire(automation: Automation, at: Date = this.now()): Promise<string | null> {
    if (this.inFlight.has(automation.id)) return null;
    this.inFlight.add(automation.id);
    try {
      const cwd = this.deps.projectPath(automation.project);
      const project = this.deps.workspace()?.projects.find((p) => p.id === automation.project);
      if (!cwd || !project) {
        this.mark(automation.id, null, at);
        this.fail(
          automation,
          `The project "${automation.project}" is not available on this machine`,
        );
        return null;
      }
      const role = this.deps.resolveRole(automation.role, automation.project);
      const handle = this.deps.runs.start({
        kind: "automation",
        providerId: role.provider,
        role,
        cwd,
        prompt: automation.prompt,
        projectId: automation.project,
      });
      this.mark(automation.id, handle.id, at);
      const result = await handle.result;
      this.deps.notifier.notify({
        kind: "automation.done",
        projectId: automation.project,
        title: result.ok
          ? `Automation finished: ${automation.id}`
          : `Automation failed: ${automation.id}`,
        body: (result.ok ? result.resultText : (result.error ?? "")).slice(0, 300) || null,
        link: { view: "project", params: { id: automation.project } },
      });
      return handle.id;
    } catch (err) {
      this.mark(automation.id, null, at);
      this.fail(automation, (err as Error).message);
      return null;
    } finally {
      this.inFlight.delete(automation.id);
    }
  }

  private fail(automation: Automation, message: string): void {
    this.deps.notifier.notify({
      kind: "automation.done",
      projectId: automation.project,
      title: `Automation failed: ${automation.id}`,
      body: message,
      link: { view: "setup" },
    });
  }

  /** Checks once now (to catch up after the app was closed), then every 30 seconds. */
  start(): void {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
