import { CLOUD_ROUTINES_PAGE, describeCloudSchedule, type CloudRoutineView, type CloudRunView, type CloudSendTo, type CloudState } from "../../../shared/cloud";
import {
  expectReply, isTriggerId, parseCloudStream, parseRoutines, parseRuns, remoteTriggerArgs,
  type CloudReply, type CloudRequest, type CloudRoutine,
} from "./remote-trigger";

/** The result of one headless claude run. */
export interface CloudExec { code: number; stdout: string; stderr: string }

export interface CloudDeps {
  /** Runs `claude` with the arguments and the owner's own sign-in; never rejects. */
  claude: (args: string[]) => Promise<CloudExec>;
  /** False when there is no claude program to run. */
  available: () => boolean;
  /** The cheapest model name. */
  model: () => string;
  changed: () => void;
  now?: () => Date;
  /** The Office project a routine's repositories belong to. */
  projectOf?: (repositories: string[]) => string | null;
  /** Where a routine's results go. */
  sendTo?: (routineId: string) => CloudSendTo;
  /** Called after each good refresh with the routines and the runs seen, for run reporting. */
  onRefreshed?: (routines: CloudRoutine[], follow: (requests: CloudRequest[]) => Promise<CloudReply[]>) => Promise<void>;
}

/** "owner/repo" of a git remote written as https or ssh, lower case; null when it is not one. */
export function repoKey(url: string): string | null {
  const match = /(?:^|[/:@])([^/:@\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

const EVERY = 30 * 60_000;
const AFTER_NEXT = 10 * 60_000;
const MAX_TIMER = 2_000_000_000;

const succeeded = (status: string | null): boolean => status !== null && /SUCCEEDED/i.test(status);
const failed = (status: string | null): boolean => status !== null && /FAIL|ERROR|CANCEL|TIMED_OUT/i.test(status);

function seconds(from: string | null, to: string | null): number | null {
  const a = from ? Date.parse(from) : NaN;
  const b = to ? Date.parse(to) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null;
}

/** Claude Code's cloud routines, read through the claude program. Office never holds the sign-in. */
export class CloudRoutines {
  private current: CloudState = { status: "loading", message: null, reason: null, refreshedAt: null, refreshing: false, routines: [] };
  private routines: CloudRoutine[] = [];
  /** A run's page in Claude, by run id, from list_runs. */
  private readonly urls = new Map<string, string>();
  private inflight?: Promise<CloudState>;
  private every?: NodeJS.Timeout;
  private after?: NodeJS.Timeout;

  constructor(private readonly deps: CloudDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  state(): CloudState {
    return this.current;
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.every = setInterval(() => void this.refresh(), EVERY);
    this.every.unref?.();
  }

  stop(): void {
    clearInterval(this.every);
    clearTimeout(this.after);
  }

  /** One headless run that makes the calls in order. */
  private async call(requests: CloudRequest[]): Promise<ReturnType<typeof parseCloudStream>> {
    const result = await this.deps.claude(remoteTriggerArgs(requests, this.deps.model()));
    return parseCloudStream(result.stdout, result.stderr, result.code);
  }

  /** Reads the routines now. A second call while one is running shares it. */
  refresh(): Promise<CloudState> {
    this.inflight ??= this.read().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private publish(next: Partial<CloudState>): void {
    this.current = { ...this.current, ...next };
    this.deps.changed();
  }

  private async read(): Promise<CloudState> {
    if (!this.deps.available()) {
      this.routines = [];
      this.publish({ status: "unavailable", message: "Claude Code is not installed, so cloud routines cannot be read.", reason: null, refreshing: false, routines: [] });
      return this.current;
    }
    this.publish({ refreshing: true });
    try {
      const reply = expectReply(await this.call([{ action: "list" }]), "list");
      if ("problem" in reply) {
        this.routines = [];
        this.publish({ status: "unavailable", message: reply.problem, reason: reply.detail, refreshing: false, routines: [] });
        return this.current;
      }
      this.routines = parseRoutines(reply.body);
      await this.followUp();
      this.publish({ status: "ok", message: null, reason: null, refreshing: false, refreshedAt: this.now().toISOString(), routines: this.views() });
      this.arm();
    } catch (error) {
      this.publish({ status: "unavailable", message: "The cloud routines could not be read.", reason: error instanceof Error ? error.message : String(error), refreshing: false, routines: [] });
    }
    return this.current;
  }

  /** The calls after a list: the pages of the last runs, then whatever run reporting needs. A failure here is not fatal. */
  private async followUp(): Promise<void> {
    const missing = this.routines.filter((routine) => routine.lastRun?.sessionId && !this.urls.has(routine.lastRun.sessionId)).slice(0, 8);
    try {
      if (missing.length > 0) {
        const stream = await this.call(missing.map((routine): CloudRequest => ({ action: "list_runs", triggerId: routine.id })));
        for (const reply of stream.replies) {
          if (reply.action !== "list_runs" || reply.status !== 200) continue;
          try { for (const run of parseRuns(reply.body)) if (run.url) this.urls.set(run.id, run.url); } catch { /* one routine's page is skipped */ }
        }
      }
    } catch { /* the pages are a convenience */ }
    await this.deps.onRefreshed?.(this.routines, async (requests) => {
      if (requests.length === 0) return [];
      return (await this.call(requests)).replies;
    }).catch(() => undefined);
  }

  /** Reads again ten minutes after the earliest next run, so a run that just happened shows up. */
  private arm(): void {
    clearTimeout(this.after);
    const now = this.now().getTime();
    const times = this.routines.filter((routine) => routine.enabled && routine.endedReason === null && routine.nextRunAt)
      .map((routine) => Date.parse(routine.nextRunAt ?? "")).filter((time) => Number.isFinite(time) && time + AFTER_NEXT > now);
    if (times.length === 0) return;
    const wait = Math.min(MAX_TIMER, Math.min(...times) + AFTER_NEXT - now);
    this.after = setTimeout(() => void this.refresh(), Math.max(wait, 1000));
    this.after.unref?.();
  }

  /** The run's page, by its id. */
  urlOf(sessionId: string | null): string | null {
    return sessionId ? this.urls.get(sessionId) ?? null : null;
  }

  /** A routine's id, only when the last list had it. */
  known(id: string): CloudRoutine | undefined {
    return isTriggerId(id) ? this.routines.find((routine) => routine.id === id) : undefined;
  }

  private views(): CloudRoutineView[] {
    const at = this.now();
    return this.routines.map((routine): CloudRoutineView => {
      const last = routine.lastRun;
      const url = this.urlOf(last?.sessionId ?? null);
      let lastRun: CloudRunView | null = null;
      if (last) {
        const done = last.finishedAt !== null;
        lastRun = {
          state: done ? (succeeded(last.status) ? "succeeded" : "failed") : failed(last.status) ? "failed" : "running",
          firedAt: last.firedAt, finishedAt: last.finishedAt, seconds: seconds(last.firedAt, last.finishedAt),
          failure: succeeded(last.status) ? null : last.failureReason, url,
        };
      }
      const finished = routine.endedReason !== null;
      return {
        id: routine.id, name: routine.name, enabled: routine.enabled, finished,
        schedule: describeCloudSchedule(routine.cron, at),
        nextRun: routine.enabled && !finished ? routine.nextRunAt : null,
        lastRun, link: url ?? CLOUD_ROUTINES_PAGE,
        sendTo: this.deps.sendTo?.(routine.id) ?? "worth-a-look",
        projectName: this.deps.projectOf?.(routine.repositories) ?? null,
        details: { model: routine.model, prompt: routine.prompt, repositories: routine.repositories, connectors: routine.connectors, cron: routine.cron, id: routine.id },
      };
    });
  }

  /** The views again, after a setting changed, without asking Claude. */
  rebuild(): void {
    if (this.current.status === "ok") this.publish({ routines: this.views() });
  }
}
