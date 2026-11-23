import { quoteAsData, durationWords, type CloudSendTo, type CloudUsage } from "../../../shared/cloud";
import { Workflow } from "../../../shared/workflow";
import type { Db } from "../../core/db";
import type { WorkflowOutputRun } from "../../core/scheduler";
import type { CloudReply, CloudRequest, CloudRoutine } from "./remote-trigger";
import { isSessionId, parseRunLog } from "./remote-trigger";

/** A run is only reported while it is this recent, so a first start does not announce old runs. */
const REPORT_WITHIN_MS = 3 * 86_400_000;
/** The runs read in one refresh. */
const PER_REFRESH = 8;
/** Tries to read a run's result before the run is reported without it. */
const READ_TRIES = 3;
const EXCERPT = 1500;

export interface ReportDeps {
  db: Db;
  root: () => string;
  now?: () => Date;
  /** Delivers a result by the same path workflow results take. */
  save: (root: string, workflow: Workflow, run: WorkflowOutputRun) => Promise<void>;
  sendTo: (routineId: string) => CloudSendTo;
  projectOf: (repositories: string[]) => { id: string; name: string } | null;
  urlOf: (sessionId: string) => string | null;
  /** A short message for the owner when a run failed. */
  failed?: (routine: string, reason: string | null, projectId: string | null) => void;
  changed: () => void;
}

export interface CloudRunFact {
  sessionId: string; routine: string; state: "succeeded" | "failed"; finishedAt: string | null; seconds: number | null;
  failure: string | null; excerpt: string | null; url: string | null;
}

/** The runs reported for a project since a moment, newest first. */
export function recentCloudRuns(db: Db, projectId: string, since: Date, limit = 5): CloudRunFact[] {
  const rows = db.prepare(`SELECT session_id, routine_name, state, finished_at, seconds, failure, excerpt, url FROM cloud_runs
    WHERE project_id = ? AND reported_at >= ? ORDER BY reported_at DESC LIMIT ?`).all(projectId, since.toISOString(), limit) as Array<{
    session_id: string; routine_name: string; state: string; finished_at: string | null; seconds: number | null;
    failure: string | null; excerpt: string | null; url: string | null;
  }>;
  return rows.map((row) => ({
    sessionId: row.session_id, routine: row.routine_name, state: row.state === "failed" ? "failed" : "succeeded", finishedAt: row.finished_at,
    seconds: row.seconds, failure: row.failure, excerpt: row.excerpt, url: row.url,
  }));
}

const slug = (id: string): string => `cloud-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** Delivers each finished cloud run once: where the routine's Send results to says, and a failure as a Needs you item. */
export class CloudReports {
  private readonly tries = new Map<string, number>();

  constructor(private readonly deps: ReportDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private reported(sessionId: string): boolean {
    return !!this.deps.db.prepare("SELECT 1 FROM cloud_runs WHERE session_id = ?").get(sessionId);
  }

  /** Reads the result of each run Office has not reported and delivers it. */
  async report(routines: CloudRoutine[], follow: (requests: CloudRequest[]) => Promise<CloudReply[]>): Promise<void> {
    const cutoff = this.now().getTime() - REPORT_WITHIN_MS;
    const fresh = routines.flatMap((routine) => {
      const last = routine.lastRun;
      const finished = last?.finishedAt ? Date.parse(last.finishedAt) : NaN;
      if (!last?.sessionId || !isSessionId(last.sessionId) || !Number.isFinite(finished) || finished < cutoff || this.reported(last.sessionId)) return [];
      return [{ routine, sessionId: last.sessionId, ok: last.status !== null && /SUCCEEDED/i.test(last.status) }];
    }).slice(0, PER_REFRESH);
    if (fresh.length === 0) return;

    // Only a succeeded run that is delivered somewhere needs its log read.
    const reading = fresh.filter((entry) => entry.ok && this.deps.sendTo(entry.routine.id) !== "nothing");
    const results = new Map<string, string | null>();
    if (reading.length > 0) {
      const replies = await follow(reading.map((entry): CloudRequest => ({ action: "get_run_log", sessionId: entry.sessionId })));
      for (const reply of replies) {
        const id = typeof reply.input?.["session_id"] === "string" ? reply.input["session_id"] : null;
        if (id && reply.status === 200) results.set(id, parseRunLog(reply.body));
      }
    }
    for (const { routine, sessionId, ok } of fresh) {
      const read = reading.some((entry) => entry.sessionId === sessionId);
      if (read && !results.has(sessionId)) {
        // The log could not be read this time: try again at the next refresh, then report without it.
        const tries = (this.tries.get(sessionId) ?? 0) + 1;
        this.tries.set(sessionId, tries);
        if (tries < READ_TRIES) continue;
      }
      await this.deliver(routine, sessionId, ok, results.get(sessionId) ?? null);
      this.tries.delete(sessionId);
    }
  }

  private async deliver(routine: CloudRoutine, sessionId: string, ok: boolean, result: string | null): Promise<void> {
    const root = this.deps.root();
    const last = routine.lastRun!;
    const project = this.deps.projectOf(routine.repositories);
    const url = this.deps.urlOf(sessionId);
    const fired = last.firedAt ? Date.parse(last.firedAt) : NaN;
    const done = last.finishedAt ? Date.parse(last.finishedAt) : NaN;
    const seconds = Number.isFinite(fired) && Number.isFinite(done) && done >= fired ? Math.round((done - fired) / 1000) : null;
    const took = durationWords(seconds);
    const choice = this.deps.sendTo(routine.id);
    const output = ok ? choice : "pending";
    const header = `${routine.name} ${ok ? "finished" : "failed"}${took ? ` after ${took}` : ""}.${url ? ` Open in Claude: ${url}` : ""}`;
    const body = ok
      ? result ? quoteAsData(result) : "Its result could not be read."
      : quoteAsData(last.failureReason ?? "No reason was given.", "a cloud routine run");
    const claimed = this.deps.db.prepare(`INSERT OR IGNORE INTO cloud_runs
      (session_id, trigger_id, routine_name, project_id, state, fired_at, finished_at, seconds, failure, url, excerpt, sent_to, reported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sessionId, routine.id, routine.name, project?.id ?? null, ok ? "succeeded" : "failed", last.firedAt, last.finishedAt, seconds,
        ok ? null : last.failureReason, url, ok ? result?.slice(0, EXCERPT) ?? null : null, ok ? choice : "pending", this.now().toISOString());
    if (claimed.changes === 0) return;
    try {
      if (output !== "nothing") {
        const workflow = Workflow.parse({
          id: slug(routine.id), name: routine.name.slice(0, 100), schedule: null, projectId: project?.id ?? null,
          read: "none", mayDo: "read", web: false, prompt: "A cloud routine run.", output, enabled: false,
        });
        await this.deps.save(root, workflow, { id: sessionId, text: `${header}\n${body}` });
      }
    } catch (error) {
      // Not delivered: forget the claim so the next refresh tries again.
      this.deps.db.prepare("DELETE FROM cloud_runs WHERE session_id = ?").run(sessionId);
      throw error;
    }
    if (!ok) this.deps.failed?.(routine.name, last.failureReason, project?.id ?? null);
    this.deps.changed();
  }

  /** The runs reported for a project since a moment, newest first. */
  recent(projectId: string, since: Date, limit = 5): CloudRunFact[] {
    return recentCloudRuns(this.deps.db, projectId, since, limit);
  }

  /** Cloud runs of the last 30 days by count and time. */
  usage(): CloudUsage {
    const since = new Date(this.now().getTime() - 30 * 86_400_000).toISOString();
    const rows = this.deps.db.prepare(`SELECT trigger_id AS id, routine_name AS name, COUNT(*) AS runs, COALESCE(SUM(seconds), 0) AS seconds
      FROM cloud_runs WHERE reported_at >= ? GROUP BY trigger_id ORDER BY runs DESC, name`).all(since) as CloudUsage["routines"];
    return { runs: rows.reduce((sum, row) => sum + row.runs, 0), seconds: rows.reduce((sum, row) => sum + row.seconds, 0), routines: rows };
  }
}
