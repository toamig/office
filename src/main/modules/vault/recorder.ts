import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PendingItem, RecordedNote, SessionRow, WrapUpResult } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import type { Db } from "../../core/db";
import { nowIso } from "../../core/util";
import { Cursor, readRecording } from "./recording-input";
import { type Entry, type RecordTarget, parseRecording, recordTarget, recordingPrompt } from "./recording-plan";
import { appendToSection, formatWaitingLine } from "./openitems";
import { notesPath } from "./scope";
import type { VaultWriter } from "./writer";

interface RecorderDeps {
  db: Db;
  writer: VaultWriter;
  workspace: () => Workspace | null;
  root: () => string;
  projectFolder: (id: string) => string | undefined;
  sessions: () => SessionRow[];
  chatsDir: string;
  terminalsDir: string;
  settings: () => { enabled: boolean; learning: boolean; idleMinutes: number };
  complete: (session: SessionRow, prompt: string) => Promise<string>;
  changed: () => void;
}

type Proposal = Pick<Entry, "destination" | "text"> & {
  id: string;
  workspace: string;
  project_id: string | null;
  created_at: string;
};

const empty = (): WrapUpResult => ({ saved: 0, proposed: 0 });

export class Recorder {
  private readonly active = new Map<string, Promise<WrapUpResult>>();
  private nextIdle = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: RecorderDeps) {
    deps.db.prepare("UPDATE recorder_proposals SET state = 'ask' WHERE state = 'writing'").run();
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.checkIdle(), 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async checkIdle(): Promise<void> {
    const { enabled, idleMinutes } = this.deps.settings();
    if (!enabled || this.active.size) return;
    const now = Date.now();
    const age = idleMinutes * 60_000;
    for (const session of this.deps.sessions()) {
      if (session.status === "starting" || session.status === "working" || session.status === "needs-you")
        continue;
      const updated = Math.max(Date.parse(session.updatedAt), Date.parse(session.lastOutputAt ?? session.updatedAt));
      if (now - updated < age || (this.nextIdle.get(session.id) ?? 0) > now) continue;
      this.nextIdle.set(session.id, now + age);
      const result = await this.record(session);
      if (result.saved || result.proposed || result.error) break;
    }
  }

  record(session: SessionRow): Promise<WrapUpResult> {
    if (session.incognito || session.provider === "terminal" || !this.deps.settings().enabled)
      return Promise.resolve(empty());
    const active = this.active.get(session.id);
    if (active) return active;
    const recording = this.recordNew(session).catch((error: unknown) => ({
      ...empty(),
      error: error instanceof Error ? error.message : "The recorder could not read this session.",
    })).finally(() => this.active.delete(session.id));
    this.active.set(session.id, recording);
    return recording;
  }

  private belongs(session: SessionRow, root: string): boolean {
    if (session.brainRoot) return resolve(session.brainRoot) === resolve(root);
    const folder = session.projectId ? this.deps.projectFolder(session.projectId) : undefined;
    return Boolean(folder && resolve(session.cwd) === resolve(folder));
  }

  private async recordNew(session: SessionRow): Promise<WrapUpResult> {
    const { db, chatsDir, terminalsDir } = this.deps;
    const ws = this.deps.workspace();
    const root = this.deps.root();
    const general = !session.projectId && (session.role === "chat" || session.role === "explore");
    if (!ws || !root || !this.belongs(session, root) || (!session.projectId && !general)) return empty();
    if (!recordTarget(ws, root, session.projectId, "journal")) return empty();
    const prev = db.prepare("SELECT cursor FROM recorder_cursors WHERE session_id = ?").get(session.id) as { cursor: string } | undefined;
    const cursor = Cursor.parse(prev ? JSON.parse(prev.cursor) : {});
    const delta = readRecording(chatsDir, terminalsDir, session.id, cursor);
    if (!delta.text.trim()) return empty();
    const learning = this.deps.settings().learning;
    const result = await this.deps.complete(session, recordingPrompt(delta.text, general, learning));
    if (this.deps.root() !== root || !this.deps.settings().enabled) return empty();
    const entries = parseRecording(result).flatMap((entry) => {
      if ((entry.destination === "lesson" || entry.destination === "profile") && !learning) return [];
      const target = this.target(root, session.projectId, entry.destination);
      return target ? [{ entry, target }] : [];
    });
    return await this.fileEntries(session, root, delta.cursor, entries);
  }

  private async fileEntries(
    session: SessionRow,
    root: string,
    cursor: Cursor,
    entries: Array<{ entry: Entry; target: RecordTarget }>,
  ): Promise<WrapUpResult> {
    const { db } = this.deps;
    const grouped = new Map<string, Proposal[]>();
    let proposed = 0;
    const insert = db.prepare("INSERT INTO recorder_proposals VALUES (?, ?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const { entry, target } of entries) {
        const proposal: Proposal = {
          id: randomUUID(), workspace: root, project_id: session.projectId,
          destination: entry.destination, text: entry.text, created_at: nowIso(),
        };
        insert.run(proposal.id, root, proposal.project_id, proposal.destination, proposal.text, proposal.created_at,
          entry.certainty === "ask" ? "ask" : "writing");
        if (entry.certainty === "ask") proposed++;
        else grouped.set(target.path, [...(grouped.get(target.path) ?? []), proposal]);
      }
      db.prepare(`INSERT INTO recorder_cursors VALUES (?, ?)
        ON CONFLICT(session_id) DO UPDATE SET cursor = excluded.cursor`).run(session.id, JSON.stringify(cursor));
    })();
    let saved = 0;
    for (const batch of grouped.values()) {
      try {
        saved += await this.save(batch);
      } catch {
        for (const row of batch) db.prepare("UPDATE recorder_proposals SET state = 'ask' WHERE id = ?").run(row.id);
        proposed += batch.length;
      }
    }
    if (entries.length) this.deps.changed();
    return { saved, proposed };
  }

  private target(root: string, projectId: string | null, destination: Entry["destination"]): RecordTarget | null {
    const ws = this.deps.workspace();
    if (!ws || this.deps.root() !== root) return null;
    const target = recordTarget(ws, root, projectId, destination);
    return target && notesPath(root, target.path) ? target : null;
  }

  private async save(batch: Proposal[]): Promise<number> {
    const first = batch[0];
    if (!first) return 0;
    const { db, writer } = this.deps;
    const target = this.target(first.workspace, first.project_id, first.destination);
    const path = target && notesPath(first.workspace, target.path);
    if (!target || !path) throw new Error("This note has no safe location in the current brain.");
    const checkPath = () => {
      const current = this.target(first.workspace, first.project_id, first.destination);
      if (!current || notesPath(first.workspace, current.path) !== path)
        throw new Error("The note's destination changed.");
    };
    mkdirSync(dirname(path), { recursive: true });
    const date = writer.today();
    const result = await writer.edit(path, `${target.name}: record ${target.path.split("/").at(-1)}`, (content) => {
      for (const row of batch) {
        const current = this.target(row.workspace, row.project_id, row.destination);
        if (current?.path !== target.path || !current.heading) throw new Error("The note's destination changed.");
        const line = row.destination === "waiting"
          ? formatWaitingLine(date, row.text, "Office recorder")
          : `- ${date} ${row.text}`;
        const textOf = (entry: string) => entry.replace(/^(- (?:\[ \] )?)\d{4}-\d{2}-\d{2} /, "$1");
        if (!content.split(/\r?\n/).some((entry) => textOf(entry) === textOf(line)))
          content = appendToSection(content, current.heading, line);
      }
      return content;
    }, target.initial, checkPath);
    db.transaction(() => {
      if (result.commit) db.prepare("INSERT INTO recorder_saves VALUES (?, ?, ?, ?, ?, ?, NULL)")
        .run(first.id, first.workspace, target.path, batch.map((row) => row.text).join(" "), result.commit, nowIso());
      for (const proposal of batch)
        db.prepare("UPDATE recorder_proposals SET state = 'saved' WHERE id = ?").run(proposal.id);
    })();
    return result.committed ? 1 : 0;
  }

  pending(): PendingItem[] {
    const rows = this.deps.db.prepare("SELECT * FROM recorder_proposals WHERE workspace = ? AND state = 'ask' ORDER BY created_at")
      .all(this.deps.root()) as Proposal[];
    return rows.map((row) => ({
      key: `save:${row.id}`, kind: "save-proposal", severity: "attention",
      projectId: row.project_id, title: "Save this?", detail: row.text,
      link: { view: "inbox" }, fingerprint: row.id, proposalId: row.id,
    }));
  }

  async answer(id: string, save: boolean): Promise<void> {
    const { db } = this.deps;
    const row = db.prepare("SELECT * FROM recorder_proposals WHERE id = ? AND workspace = ? AND state = 'ask'")
      .get(id, this.deps.root()) as Proposal | undefined;
    if (!row) return;
    const claimed = db.prepare("UPDATE recorder_proposals SET state = ? WHERE id = ? AND state = 'ask'")
      .run(save ? "writing" : "dismissed", id);
    if (!claimed.changes) return;
    try {
      if (save) await this.save([row]);
    } catch (error) {
      db.prepare("UPDATE recorder_proposals SET state = 'ask' WHERE id = ?").run(id);
      throw error;
    }
    this.deps.changed();
  }

  markBrief(): void {
    const { db } = this.deps;
    const root = this.deps.root();
    db.prepare(`INSERT INTO recorder_brief VALUES (?, '', ?)
      ON CONFLICT(workspace) DO UPDATE SET since = cutoff, cutoff = excluded.cutoff`).run(root, nowIso());
  }

  digest(): RecordedNote[] {
    const { db } = this.deps;
    const root = this.deps.root();
    const mark = db.prepare("SELECT since FROM recorder_brief WHERE workspace = ?").get(root) as { since: string } | undefined;
    return db.prepare(`SELECT id, path, summary FROM recorder_saves WHERE workspace = ? AND undone_at IS NULL
      AND saved_at >= ? ORDER BY saved_at DESC`).all(root, mark?.since ?? "") as RecordedNote[];
  }

  async undo(id: string): Promise<void> {
    const { db, writer } = this.deps;
    const root = this.deps.root();
    const saved = db.prepare("SELECT path, git_commit FROM recorder_saves WHERE id = ? AND workspace = ? AND undone_at IS NULL")
      .get(id, root) as { path: string; git_commit: string } | undefined;
    const file = saved && notesPath(root, saved.path);
    if (!saved || !file) throw new Error("This save is unavailable.");
    await writer.revert(file, saved.git_commit, () => {
      if (this.deps.root() !== root || notesPath(root, saved.path) !== file)
        throw new Error("The note's destination changed.");
    });
    db.prepare("UPDATE recorder_saves SET undone_at = ? WHERE id = ?").run(nowIso(), id);
    this.deps.changed();
  }
}
