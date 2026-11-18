import { randomUUID } from "node:crypto";
import type { PtyHistory, SessionRow, SessionStatus, StartSession } from "../../../shared/models";
import type { Role, Workspace } from "../../../shared/types";
import type { Bus } from "../../core/bus";
import type { Db } from "../../core/db";
import { IpcFailure } from "../../core/ipc";
import type { Notifier } from "../../core/notifier";
import { nowIso } from "../../core/util";
import type { ProviderRegistry } from "../providers/registry";
import type { CommandSpec } from "../providers/types";
import { PtyManager } from "./pty-manager";
import {
  statusForClaudeHook,
  statusForCodexEvent,
  statusOnOutput,
  statusOnTick,
  type LiveState,
} from "./status";

export interface SessionServiceDeps {
  db: Db;
  bus: Bus;
  providers: ProviderRegistry;
  notifier: Notifier;
  workspace: () => Workspace | null;
  /** Absolute folder of a project, or undefined. */
  projectPath: (projectId: string) => string | undefined;
  logsDir: string;
}

interface DbSession {
  id: string;
  provider: string;
  provider_session_id: string | null;
  project_id: string | null;
  cwd: string;
  branch: string | null;
  role: string | null;
  title: string | null;
  status: SessionStatus;
  interactive: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  archived_at: string | null;
  last_output_at: string | null;
  captured_at: string | null;
}

interface Runtime extends LiveState {
  killedByUser: boolean;
  pendingPrompt?: string;
  promptTimer?: NodeJS.Timeout;
  quietTimer?: NodeJS.Timeout;
}

const normalize = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Starts, tracks and ends interactive agent sessions and plain terminals. */
export class SessionService {
  readonly pty: PtyManager;
  /** Where terminal output goes (the renderer); set by the app shell. */
  sink: ((id: string, data: string, end: number) => void) | null = null;
  private readonly runtime = new Map<string, Runtime>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: SessionServiceDeps) {
    this.pty = new PtyManager(deps.logsDir, {
      onData: (id, data, end) => this.handleData(id, data, end),
      onExit: (id, code) => this.handleExit(id, code),
    });
    // Terminals die with the app, so anything still marked live from the last run has ended.
    const now = nowIso();
    deps.db
      .prepare(
        `UPDATE sessions SET status = 'exited', ended_at = COALESCE(ended_at, ?), updated_at = ?
         WHERE status IN ('starting','working','needs-you','idle')`,
      )
      .run(now, now);
  }

  startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), 2000);
  }

  stopTimer(): void {
    clearInterval(this.timer);
  }

  // ---------- queries ----------

  private row(r: DbSession): SessionRow {
    return {
      id: r.id,
      provider: r.provider,
      providerSessionId: r.provider_session_id,
      projectId: r.project_id,
      cwd: r.cwd,
      branch: r.branch,
      role: r.role,
      title: r.title,
      status: r.status,
      interactive: r.interactive === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      endedAt: r.ended_at,
      archivedAt: r.archived_at,
      lastOutputAt: r.last_output_at,
      capturedAt: r.captured_at,
      running: this.pty.isRunning(r.id),
    };
  }

  find(id: string): SessionRow | undefined {
    const r = this.deps.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      DbSession | undefined;
    return r ? this.row(r) : undefined;
  }

  get(id: string): SessionRow {
    const found = this.find(id);
    if (!found) throw new IpcFailure("not-found", `No session ${id}`);
    return found;
  }

  list(opts: { projectId?: string; includeArchived?: boolean } = {}): SessionRow[] {
    const where: string[] = [];
    const args: string[] = [];
    if (!opts.includeArchived) where.push("archived_at IS NULL");
    if (opts.projectId) {
      where.push("project_id = ?");
      args.push(opts.projectId);
    }
    const sql = `SELECT * FROM sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
    return (this.deps.db.prepare(sql).all(...args) as DbSession[]).map((r) => this.row(r));
  }

  // ---------- starting and resuming ----------

  /** Resolves a role id, honouring a project's override (plan 5.2). */
  resolveRole(roleId: string, projectId?: string): Role {
    const ws = this.deps.workspace();
    const project = ws?.projects.find((p) => p.id === projectId);
    const target = project?.roles?.[roleId] ?? roleId;
    const role = ws?.roles[target];
    if (!role) throw new IpcFailure("no-role", `There is no role called "${target}"`);
    return role;
  }

  start(input: StartSession): SessionRow {
    let role: Role | undefined;
    if (input.roleId) role = this.resolveRole(input.roleId, input.projectId);
    const providerId = role?.provider ?? input.providerId ?? "claude-code";
    const provider = this.deps.providers.get(providerId);
    if (!provider) throw new IpcFailure("no-provider", `Unknown provider "${providerId}"`);
    if (input.model)
      role = {
        ...(role ?? { provider: providerId, instructions: "", readOnly: false }),
        model: input.model,
      };
    const cwd = input.cwd ?? (input.projectId ? this.deps.projectPath(input.projectId) : undefined);
    if (!cwd) throw new IpcFailure("no-folder", "Pick a project or a folder to run in");
    const id = randomUUID();
    const spec = provider.interactiveCommand({
      cwd,
      officeSessionId: id,
      ...(role ? { role } : {}),
    });
    const title = input.title ?? (input.roleId ? `${input.roleId}` : provider.label);
    return this.launch({
      id,
      provider: providerId,
      spec,
      cwd,
      projectId: input.projectId ?? null,
      roleId: input.roleId ?? null,
      title,
      ...(input.prompt ? { prompt: input.prompt } : {}),
    });
  }

  /** Starts any command in a terminal tab (logins, and tests). */
  startCommand(spec: CommandSpec, title: string, cwd: string, provider = "terminal"): SessionRow {
    return this.launch({
      id: randomUUID(),
      provider,
      spec,
      cwd,
      projectId: null,
      roleId: null,
      title,
    });
  }

  private launch(o: {
    id: string;
    provider: string;
    spec: CommandSpec;
    cwd: string;
    projectId: string | null;
    roleId: string | null;
    title: string;
    prompt?: string;
    existing?: boolean;
  }): SessionRow {
    const now = nowIso();
    if (!o.existing) {
      this.deps.db
        .prepare(
          `INSERT INTO sessions (id, provider, provider_session_id, project_id, cwd, branch, role, title, status,
             interactive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'starting', 1, ?, ?)`,
        )
        .run(
          o.id,
          o.provider,
          o.provider === "claude-code" || o.provider === "fake" ? o.id : null,
          o.projectId,
          o.cwd,
          o.roleId,
          o.title,
          now,
          now,
        );
    } else {
      this.deps.db
        .prepare(
          "UPDATE sessions SET status = 'starting', ended_at = NULL, archived_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, o.id);
    }
    const state: Runtime = {
      status: "starting",
      hookSeen: false,
      lastOutputMs: Date.now(),
      lastWriteMs: 0,
      killedByUser: false,
      ...(o.prompt ? { pendingPrompt: o.prompt } : {}),
    };
    this.runtime.set(o.id, state);
    try {
      this.pty.spawn(o.id, o.spec, { cwd: o.cwd });
    } catch (err) {
      this.setStatus(o.id, "failed", (err as Error).message);
      throw new IpcFailure("spawn-failed", `Could not start ${o.title}: ${(err as Error).message}`);
    }
    this.deps.bus.emit(
      "session.status",
      { id: o.id, status: "starting" },
      o.projectId ?? undefined,
    );
    return this.get(o.id);
  }

  /** Reopens a past session with the tool's own resume command, keeping the same Office row. */
  resume(id: string): SessionRow {
    const row = this.get(id);
    if (row.running) return row;
    const provider = this.deps.providers.get(row.provider);
    if (!provider) throw new IpcFailure("no-provider", `The ${row.provider} tool is not available`);
    const providerSessionId = row.providerSessionId ?? row.id;
    const spec = provider.resumeCommand(providerSessionId, { cwd: row.cwd, officeSessionId: id });
    this.pty.release(id);
    return this.launch({
      id,
      provider: row.provider,
      spec,
      cwd: row.cwd,
      projectId: row.projectId,
      roleId: row.role,
      title: row.title ?? provider.label,
      existing: true,
    });
  }

  // ---------- terminal plumbing ----------

  write(id: string, data: string): void {
    const rt = this.runtime.get(id);
    if (rt) rt.lastWriteMs = Date.now();
    this.pty.write(id, data);
  }

  /** Sends a whole line, as if typed (used for review comments and first prompts). */
  sendLine(id: string, text: string): void {
    this.write(id, `${text}\r`);
  }

  resize(id: string, cols: number, rows: number): void {
    this.pty.resize(id, cols, rows);
  }

  history(id: string): PtyHistory {
    return this.pty.history(id);
  }

  /** Ends the terminal process. The session is marked exited, not failed. */
  kill(id: string): void {
    const rt = this.runtime.get(id);
    if (rt) rt.killedByUser = true;
    this.pty.kill(id);
  }

  rename(id: string, title: string): void {
    this.deps.db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, nowIso(), id);
    this.emitStatus(id);
  }

  archive(id: string): void {
    this.kill(id);
    this.deps.db
      .prepare("UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), nowIso(), id);
    this.emitStatus(id);
  }

  markCaptured(id: string): void {
    this.deps.db.prepare("UPDATE sessions SET captured_at = ? WHERE id = ?").run(nowIso(), id);
    this.emitStatus(id);
  }

  setBranch(id: string, branch: string | null): void {
    this.deps.db.prepare("UPDATE sessions SET branch = ? WHERE id = ?").run(branch, id);
  }

  // ---------- status ----------

  private handleData(id: string, data: string, end: number): void {
    this.sink?.(id, data, end);
    const rt = this.runtime.get(id);
    if (!rt) return;
    const now = Date.now();
    rt.lastOutputMs = now;
    this.deps.db
      .prepare("UPDATE sessions SET last_output_at = ? WHERE id = ?")
      .run(new Date(now).toISOString(), id);
    const next = statusOnOutput(rt, now);
    if (next) this.setStatus(id, next);
    this.schedulePrompt(id, rt);
  }

  /** Types the first prompt once the tool has drawn its screen and gone quiet. */
  private schedulePrompt(id: string, rt: Runtime): void {
    if (!rt.pendingPrompt) return;
    clearTimeout(rt.quietTimer);
    rt.quietTimer = setTimeout(() => {
      const prompt = rt.pendingPrompt;
      rt.pendingPrompt = undefined;
      if (prompt) this.sendLine(id, prompt);
    }, 900);
  }

  private handleExit(id: string, code: number): void {
    const rt = this.runtime.get(id);
    clearTimeout(rt?.quietTimer);
    const current = this.find(id);
    if (current && (current.status === "exited" || current.status === "failed")) {
      this.deps.db
        .prepare("UPDATE sessions SET ended_at = COALESCE(ended_at, ?) WHERE id = ?")
        .run(nowIso(), id);
      return;
    }
    const failed = code !== 0 && !rt?.killedByUser;
    this.setStatus(id, failed ? "failed" : "exited", failed ? `exit code ${code}` : undefined);
  }

  private tick(): void {
    const now = Date.now();
    for (const [id, rt] of this.runtime) {
      const next = statusOnTick(rt, now);
      if (next) {
        this.setStatus(id, next);
        this.deps.bus.emit("session.output-idle", { id });
      }
    }
  }

  private emitStatus(id: string): void {
    const row = this.find(id);
    if (row)
      this.deps.bus.emit("session.status", { id, status: row.status }, row.projectId ?? undefined);
  }

  /** Sets a status, tells the UI, and raises the notification that goes with it. */
  setStatus(id: string, status: SessionStatus, detail?: string): void {
    const before = this.find(id);
    if (!before) return;
    const rt = this.runtime.get(id);
    if (rt) rt.status = status;
    const now = nowIso();
    const ended = status === "exited" || status === "failed";
    this.deps.db
      .prepare(
        `UPDATE sessions SET status = ?, updated_at = ?, ended_at = CASE WHEN ? THEN COALESCE(ended_at, ?) ELSE ended_at END WHERE id = ?`,
      )
      .run(status, now, ended ? 1 : 0, now, id);
    this.deps.bus.emit("session.status", { id, status }, before.projectId ?? undefined);
    if (before.status === status) return;
    this.notifyFor(before, status, detail);
  }

  private notifyFor(session: SessionRow, status: SessionStatus, detail?: string): void {
    if (session.provider === "terminal") return;
    const label = session.title ?? session.provider;
    const link = { view: "agents", params: { session: session.id } };
    const projectId = session.projectId;
    if (status === "needs-you") {
      this.deps.notifier.notify({
        kind: "agent.needs-you",
        projectId,
        title: `${label} needs you`,
        body: detail ?? null,
        link,
      });
    } else if (status === "failed") {
      this.deps.notifier.notify({
        kind: "agent.failed",
        projectId,
        title: `${label} failed`,
        body: detail ?? null,
        link,
      });
    } else if (status === "exited") {
      this.deps.notifier.notify({
        kind: "agent.done",
        projectId,
        title: `${label} finished`,
        body: null,
        link,
      });
    }
  }

  // ---------- hook events (plan 9) ----------

  /** A Claude Code hook event, relayed by office-relay.mjs. Returns true when a session matched. */
  onClaudeHook(payload: Record<string, unknown>): boolean {
    const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : "";
    const event = typeof payload["hook_event_name"] === "string" ? payload["hook_event_name"] : "";
    const row = this.deps.db
      .prepare("SELECT id FROM sessions WHERE id = ? OR provider_session_id = ?")
      .get(sessionId, sessionId) as { id: string } | undefined;
    if (!row) return false;
    const rt = this.runtime.get(row.id);
    if (rt) rt.hookSeen = true;
    const status = statusForClaudeHook(event);
    if (!status) return true;
    const detail = typeof payload["message"] === "string" ? payload["message"] : undefined;
    this.setStatus(row.id, status, detail);
    return true;
  }

  /** A Codex notify event: map by thread id, or by folder plus the newest running Codex session there. */
  onCodexEvent(payload: Record<string, unknown>): boolean {
    const thread =
      typeof payload["thread-id"] === "string"
        ? payload["thread-id"]
        : typeof payload["thread_id"] === "string"
          ? payload["thread_id"]
          : "";
    const cwd = typeof payload["cwd"] === "string" ? payload["cwd"] : "";
    const rows = this.deps.db
      .prepare(
        "SELECT * FROM sessions WHERE provider = 'codex' AND status != 'exited' AND status != 'failed' ORDER BY created_at DESC",
      )
      .all() as DbSession[];
    let match = thread ? rows.find((r) => r.provider_session_id === thread) : undefined;
    if (!match && cwd)
      match = rows.find((r) => normalize(r.cwd) === normalize(cwd) && !r.provider_session_id);
    if (!match && cwd) match = rows.find((r) => normalize(r.cwd) === normalize(cwd));
    if (!match) return false;
    if (thread && !match.provider_session_id) {
      this.deps.db
        .prepare("UPDATE sessions SET provider_session_id = ? WHERE id = ?")
        .run(thread, match.id);
    }
    const rt = this.runtime.get(match.id);
    if (rt) rt.hookSeen = true;
    const status = statusForCodexEvent(typeof payload["type"] === "string" ? payload["type"] : "");
    if (status) this.setStatus(match.id, status);
    return true;
  }

  shutdown(): void {
    this.stopTimer();
    this.pty.killAll();
  }
}
