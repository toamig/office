import { randomUUID } from "node:crypto";
import type { NotificationLink, NotificationRow } from "../../shared/models";
import type { Workspace } from "../../shared/types";
import type { Bus } from "./bus";
import type { Db } from "./db";

/** Where an urgent notification goes besides the inbox (desktop alert, phone ping, modules). */
export interface Channel {
  id: string;
  send(notification: NotificationRow): void | Promise<void>;
}

export interface NotifyInput {
  kind: string;
  projectId?: string | null;
  title: string;
  body?: string | null;
  link?: NotificationLink | null;
}

export interface NotifierDeps {
  db: Db;
  bus: Bus;
  workspace: () => Workspace | null;
  quietHours: () => { from: string; to: string } | undefined;
  now?: () => Date;
  channels?: Channel[];
}

const DEDUP_WINDOW_MS = 10 * 60 * 1000;

interface DbRow {
  id: string;
  kind: string;
  project_id: string | null;
  title: string;
  body: string | null;
  link: string | null;
  urgent: number;
  created_at: string;
}

const toRow = (r: DbRow): NotificationRow => ({
  id: r.id,
  kind: r.kind,
  projectId: r.project_id,
  title: r.title,
  body: r.body,
  link: r.link ? (JSON.parse(r.link) as NotificationLink) : null,
  urgent: r.urgent === 1,
  createdAt: r.created_at,
  readAt: null,
});

/** True when `now` falls in the quiet-hours window ("22:00" to "07:00" may wrap midnight). */
export function inQuietHours(now: Date, quiet: { from: string; to: string } | undefined): boolean {
  if (!quiet) return false;
  const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const current = now.getHours() * 60 + now.getMinutes();
  const from = toMinutes(quiet.from);
  const to = toMinutes(quiet.to);
  if (from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/**
 * The alert ledger: urgent things are sent to the channels once (desktop alert, phone ping). It is not shown anywhere;
 * what waits on the owner is derived from live state (PendingService).
 */
export class Notifier {
  private readonly channels: Channel[];
  constructor(private readonly deps: NotifierDeps) {
    this.channels = deps.channels ?? [];
  }

  addChannel(channel: Channel): void {
    this.channels.push(channel);
  }

  removeChannel(id: string): void {
    const at = this.channels.findIndex((c) => c.id === id);
    if (at >= 0) this.channels.splice(at, 1);
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  notify(input: NotifyInput): NotificationRow {
    const { db } = this.deps;
    const at = this.now();
    const iso = at.toISOString();
    const project = input.projectId ?? null;
    const ws = this.deps.workspace();
    // A task is stopped until the owner answers a permission request, so it is always urgent.
    const urgent =
      input.kind === "permission.request" ||
      (ws?.notifications.urgent.includes(input.kind) ?? false);
    const muted = project !== null && (ws?.notifications.mutedProjects.includes(project) ?? false);
    const link = input.link ? JSON.stringify(input.link) : null;

    const since = new Date(at.getTime() - DEDUP_WINDOW_MS).toISOString();
    // One row per permission request, however alike they look.
    const existing =
      input.kind === "permission.request"
        ? undefined
        : (db
            .prepare(
              `SELECT * FROM notifications WHERE kind = ? AND title = ? AND project_id IS ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
            )
            .get(input.kind, input.title, project, since) as DbRow | undefined);

    if (existing) {
      db.prepare("UPDATE notifications SET body = ?, link = ?, created_at = ? WHERE id = ?").run(
        input.body ?? null,
        link,
        iso,
        existing.id,
      );
      return this.get(existing.id);
    }
    // Only what the alert rules need is kept: what was alerted within the window that stops repeats.
    db.prepare("DELETE FROM notifications WHERE created_at < ?").run(since);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO notifications (id, kind, project_id, title, body, link, urgent, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(id, input.kind, project, input.title, input.body ?? null, link, urgent ? 1 : 0, iso);
    const row = this.get(id);
    if (urgent && !muted && !inQuietHours(at, this.deps.quietHours())) {
      for (const channel of this.channels) {
        void Promise.resolve(channel.send(row)).catch((err) =>
          console.error(`notification channel ${channel.id} failed:`, err),
        );
      }
    }
    return row;
  }

  get(id: string): NotificationRow {
    return toRow(this.deps.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as DbRow);
  }

  /** What was alerted within the window that stops repeats, newest first (the ledger; never shown to the owner). */
  list(): NotificationRow[] {
    return (
      this.deps.db.prepare("SELECT * FROM notifications ORDER BY created_at DESC").all() as DbRow[]
    ).map(toRow);
  }
}
