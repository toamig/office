import type {
  PendingItem,
  SyncReport,
  PermissionRequest,
  PrInfo,
  ProjectSummary,
  RunInfo,
  SessionRow,
  TaskView,
  WaitingEntry,
} from "../../../shared/models";
import type { Bus } from "../../core/bus";
import type { Db } from "../../core/db";

/** Where the pending items come from; each is read live every time, so nothing is stored. */
export interface PendingSources {
  sessions: () => SessionRow[];
  tasks: () => TaskView[];
  permissions: () => PermissionRequest[];
  projects: () => ProjectSummary[];
  waiting: () => WaitingEntry[];
  github: () => Array<{ projectId: string; ci: RunInfo | null; reviews: PrInfo[] }>;
  proposals?: () => PendingItem[];
}

export interface PendingDeps {
  db: Db;
  bus: Bus;
  sources: PendingSources;
  now?: () => Date;
}

/** The bus events after which the list may have changed. */
const WATCHED = [
  "session.status",
  "task.changed",
  "permission.changed",
  "project.status",
  "vault.changed",
  "recorder.changed",
  "workflow.changed",
  "workspace.changed",
] as const;

const SEVERITY = { danger: 2, attention: 1 } as const;

/**
 * What waits on the owner right now: derived from live state, never stored as a message. An item exists exactly while
 * its state is unresolved and is gone the moment it is resolved; Dismiss hides one until the state behind it changes.
 */
export class PendingService {
  /** Called with the count after a change, for the taskbar badge. */
  onCount?: (count: number) => void;
  private timer: NodeJS.Timeout | undefined;
  private last = "";
  /** Repos whose last sync ended in a conflict or a failed push; a later good sync clears them. */
  private readonly syncProblems = new Map<
    string,
    { kind: "conflict" | "push-failed"; name: string; reason: string; projectId: string | null }
  >();

  constructor(private readonly deps: PendingDeps) {
    for (const event of WATCHED) deps.bus.on(event, () => this.changed());
  }

  /** Every pending item, the most serious first. */
  list(): PendingItem[] {
    const all = this.collect();
    const rows = this.deps.db
      .prepare("SELECT key, fingerprint FROM dismissed_pending")
      .all() as Array<{
      key: string;
      fingerprint: string;
    }>;
    const dismissed = new Map(rows.map((r) => [r.key, r.fingerprint]));
    const live = new Set(all.map((i) => i.key));
    // A dismissal of something that is no longer pending is forgotten, so it can come back as a new problem.
    for (const key of dismissed.keys())
      if (!live.has(key))
        this.deps.db.prepare("DELETE FROM dismissed_pending WHERE key = ?").run(key);
    return all
      .filter((i) => dismissed.get(i.key) !== i.fingerprint)
      .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
  }

  /** What a sync found: a conflict or a failed push stays pending until a later sync of that repo is fine. */
  onSyncReport(report: SyncReport): void {
    for (const repo of report.repos) {
      const projectId = repo.id.startsWith("hub:") ? null : repo.id;
      if (repo.action === "conflict")
        this.syncProblems.set(repo.id, {
          kind: "conflict",
          name: repo.name,
          reason: repo.reason ?? "Local and remote changes conflict; nothing was merged.",
          projectId,
        });
      else if (repo.action === "failed" && repo.pushFailed)
        this.syncProblems.set(repo.id, {
          kind: "push-failed",
          name: repo.name,
          reason: repo.reason ?? "The push did not go through.",
          projectId,
        });
      else if (repo.action !== "skipped" && repo.action !== "failed")
        this.syncProblems.delete(repo.id);
    }
    this.changed();
  }

  /** Hides an item the owner chooses to ignore, until its state changes. */
  dismiss(key: string, fingerprint: string): void {
    this.deps.db
      .prepare(
        `INSERT INTO dismissed_pending (key, fingerprint, dismissed_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET fingerprint = excluded.fingerprint, dismissed_at = excluded.dismissed_at`,
      )
      .run(key, fingerprint, (this.deps.now?.() ?? new Date()).toISOString());
    this.changed(true);
  }

  /** The most serious severity among the items, or null with none. */
  static worst(items: PendingItem[]): "danger" | "attention" | null {
    if (items.some((i) => i.severity === "danger")) return "danger";
    return items.length > 0 ? "attention" : null;
  }

  /** Tells the app the list may have changed, once things have been quiet for a moment. */
  changed(now = false): void {
    clearTimeout(this.timer);
    const run = (): void => {
      const items = this.list();
      const signature = items.map((i) => `${i.key}:${i.fingerprint}`).join("|");
      this.onCount?.(items.length);
      if (signature === this.last) return;
      this.last = signature;
      this.deps.bus.emit("pending.changed", { count: items.length });
    };
    if (now) run();
    else this.timer = setTimeout(run, 80);
  }

  private collect(): PendingItem[] {
    const { sources } = this.deps;
    const items: PendingItem[] = sources.proposals?.() ?? [];
    const projects = sources.projects();
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const where = (id: string | null): string => (id ? (projectName.get(id) ?? "") : "");

    for (const s of sources.sessions()) {
      if (s.archivedAt || s.provider === "terminal") continue;
      if (s.status !== "needs-you" && s.status !== "failed") continue;
      const label = s.title ?? s.provider;
      const failed = s.status === "failed";
      items.push({
        key: `session:${s.id}`,
        kind: failed ? "agent-failed" : "agent-needs-you",
        severity: failed ? "danger" : "attention",
        projectId: s.projectId,
        title: failed ? `${label} failed` : `${label} needs you`,
        detail: where(s.projectId) || null,
        link: { view: "agents", params: { session: s.id } },
        fingerprint: s.status,
      });
    }
    for (const t of sources.tasks()) {
      if (t.status !== "waiting-gate" && t.status !== "failed") continue;
      const gate = t.status === "waiting-gate";
      const stage = t.stages[t.stageIndex];
      items.push({
        key: `task:${t.id}`,
        kind: gate ? "task-gate" : "task-failed",
        severity: gate ? "attention" : "danger",
        projectId: t.projectId,
        title: gate
          ? `Approve ${stage?.stageId ?? "the stage"} of "${t.title}"`
          : `"${t.title}" failed`,
        detail: `${t.projectName}, ${t.pipelineName}`,
        link: { view: "board", params: { task: t.id } },
        fingerprint: `${t.status}:${t.stageIndex}`,
      });
    }
    for (const r of sources.permissions()) {
      items.push({
        key: `permission:${r.id}`,
        kind: "permission",
        severity: "attention",
        projectId: r.projectId,
        title: `${r.subject} asks to use ${r.toolName}`,
        detail: r.summary,
        link: r.taskId ? { view: "board", params: { task: r.taskId } } : { view: "inbox" },
        fingerprint: r.id,
      });
    }
    for (const [id, problem] of this.syncProblems) {
      const conflict = problem.kind === "conflict";
      items.push({
        key: `${problem.kind}:${id}`,
        kind: problem.kind,
        severity: "danger",
        projectId: problem.projectId,
        title: conflict ? `Sync conflict in ${problem.name}` : `Push failed in ${problem.name}`,
        detail: problem.reason,
        link: problem.projectId
          ? { view: "project", params: { id: problem.projectId } }
          : { view: "git" },
        fingerprint: problem.reason,
      });
    }
    for (const p of projects) {
      if (p.archived || p.conflicted === 0 || this.syncProblems.has(p.id)) continue;
      items.push({
        key: `conflict:${p.id}`,
        kind: "conflict",
        severity: "danger",
        projectId: p.id,
        title: `Merge conflict in ${p.name}`,
        detail: `${p.conflicted} ${p.conflicted === 1 ? "file" : "files"} to resolve`,
        link: { view: "git", params: { project: p.id } },
        fingerprint: String(p.conflicted),
      });
    }
    for (const g of sources.github()) {
      if (g.ci) {
        items.push({
          key: `ci:${g.projectId}`,
          kind: "ci-failed",
          severity: "danger",
          projectId: g.projectId,
          title: `Checks failed in ${where(g.projectId)}`,
          detail: `${g.ci.name} on ${g.ci.headBranch}`,
          link: { view: "git", params: { project: g.projectId, tab: "prs" } },
          fingerprint: g.ci.url,
        });
      }
      for (const pr of g.reviews) {
        items.push({
          key: `review:${g.projectId}:${pr.number}`,
          kind: "review-requested",
          severity: "attention",
          projectId: g.projectId,
          title: `Review requested in ${where(g.projectId)}: #${pr.number}`,
          detail: pr.title,
          link: { view: "git", params: { project: g.projectId, tab: "prs" } },
          fingerprint: pr.url,
        });
      }
    }
    for (const w of sources.waiting()) {
      items.push({
        key: `waiting:${w.projectId}:${w.raw}`,
        kind: "waiting",
        severity: "attention",
        projectId: w.projectId,
        title: w.text,
        detail: w.projectName,
        link: { view: "project", params: { id: w.projectId } },
        fingerprint: w.raw,
        waitingRaw: w.raw,
      });
    }
    return items;
  }
}
