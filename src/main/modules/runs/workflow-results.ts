import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { NotificationLink, PendingItem } from "../../../shared/models";
import type { Workflow, WorkflowItem, WorkflowResult } from "../../../shared/workflow";
import type { Db } from "../../core/db";
import { IpcFailure } from "../../core/ipc";
import type { WorkflowOutputRun } from "../../core/scheduler";
import { nowIso } from "../../core/util";

const daysFrom = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};
const normalize = (title: string) =>
  title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function identity(item: WorkflowItem, plain: boolean): string {
  const title = normalize(plain ? `${item.title} ${item.why}` : item.title);
  return createHash("sha256").update(JSON.stringify([plain, title, [...item.projectIds].sort()])).digest("hex");
}

type Row = {
  id: string;
  workflowId: string;
  workflowName: string | null;
  runId: string | null;
  title: string;
  detail: string;
  projectId: string | null;
  projectIds: string | null;
  sources: string | null;
  firstStep: string | null;
  createdAt: string;
  discussionId: string | null;
};
const columns = `id, workflow_id AS workflowId, workflow_name AS workflowName, run_id AS runId, title, detail,
  project_id AS projectId, project_ids AS projectIds, sources, first_step AS firstStep,
  created_at AS createdAt, discussion_id AS discussionId`;
const active = `dismissed_at IS NULL AND decided_at IS NULL AND created_at > ?
  AND (later_until IS NULL OR later_until <= ?)`;

const strings = z.array(z.string());
function readList(json: string | null, fallback: string[]): string[] {
  if (!json) return fallback;
  try {
    return strings.parse(JSON.parse(json));
  } catch {
    return fallback;
  }
}

function view(row: Row): WorkflowResult {
  return {
    id: row.id, workflowId: row.workflowId, workflowName: row.workflowName ?? row.workflowId,
    runId: row.runId ?? `${row.workflowId}:${row.createdAt.slice(0, 16)}`, createdAt: row.createdAt,
    title: row.title, why: row.detail, firstStep: row.firstStep ?? "",
    projectIds: readList(row.projectIds, row.projectId ? [row.projectId] : []),
    sources: readList(row.sources, []),
  };
}

export class WorkflowResults {
  constructor(private readonly deps: {
    db: Db; root: () => string; changed: () => void;
    saveNote: (projectId: string | null, text: string) => Promise<void>;
    startDiscussion?: (item: WorkflowResult, sourceProject: string | null) => string;
    chatAvailable?: (id: string) => boolean;
  }) {}

  async save(root: string, workflow: Workflow, run: WorkflowOutputRun): Promise<void> {
    if (this.deps.root() !== root) return;
    const text = run.text.trim();
    if (workflow.output === "note") {
      if (text) await this.deps.saveNote(workflow.projectId, text.slice(0, 6000));
      return;
    }
    if (workflow.output === "pending") {
      if (!text) return;
      this.deps.db.prepare(`INSERT INTO workflow_results
        (id, workspace, workflow_id, title, detail, project_id, output, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .run(randomUUID(), root, workflow.id, workflow.name, text.slice(0, 3000), workflow.projectId, nowIso());
    } else {
      this.storeItems(root, workflow, run);
    }
    this.deps.changed();
  }

  private storeItems(root: string, workflow: Workflow, run: WorkflowOutputRun): void {
    const plain = run.items == null;
    const items = run.items ?? [{
      title: workflow.name,
      why: run.text.trim().slice(0, 6000) || "The workflow did not return a readable item.",
      projectIds: workflow.projectId ? [workflow.projectId] : [],
      sources: [], firstStep: "",
    }];
    const createdAt = nowIso();
    const cutoff = daysFrom(-14);
    const insert = this.deps.db.prepare(`INSERT INTO workflow_results
      (id, workspace, workflow_id, workflow_name, run_id, title, detail, project_id, project_ids,
        sources, first_step, item_key, output, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'worth-a-look', ?)`);
    const known = this.deps.db.prepare(`SELECT 1 FROM workflow_results
      WHERE workspace = ? AND output = 'worth-a-look' AND item_key = ?
      AND (dismissed_at IS NOT NULL OR decided_at IS NOT NULL OR created_at > ?) LIMIT 1`);
    const legacy = this.deps.db.prepare(`SELECT title, project_id AS projectId FROM workflow_results
      WHERE workspace = ? AND output = 'worth-a-look' AND item_key IS NULL AND dismissed_at IS NOT NULL`)
      .all(root) as Array<{ title: string; projectId: string | null }>;
    this.deps.db.transaction(() => {
      for (const item of items) {
        const key = identity(item, plain);
        if (known.get(root, key, cutoff)) continue;
        if (!plain && legacy.some((row) => normalize(row.title) === normalize(item.title)
          && (row.projectId ? item.projectIds.includes(row.projectId) : item.projectIds.length === 0))) continue;
        insert.run(randomUUID(), root, workflow.id, workflow.name, run.id, item.title, item.why, workflow.projectId,
          JSON.stringify(item.projectIds), JSON.stringify(item.sources), item.firstStep, key, createdAt);
      }
    })();
  }

  list(): WorkflowResult[] {
    const rows = this.deps.db.prepare(`SELECT ${columns} FROM workflow_results
      WHERE workspace = ? AND output = 'worth-a-look' AND ${active}
      ORDER BY created_at DESC, rowid LIMIT 50`).all(this.deps.root(), daysFrom(-14), nowIso()) as Row[];
    return rows.map(view);
  }

  pending(): PendingItem[] {
    const rows = this.deps.db.prepare(`SELECT ${columns} FROM workflow_results
      WHERE workspace = ? AND output = 'pending' AND dismissed_at IS NULL
      ORDER BY created_at DESC LIMIT 50`).all(this.deps.root()) as Row[];
    return rows.map((row) => ({
      key: `workflow:${row.id}`, kind: "workflow", severity: "attention",
      projectId: row.projectId, title: row.title, detail: row.detail,
      link: row.projectId ? { view: "project", params: { id: row.projectId } } : { view: "home" },
      fingerprint: row.id, workflowResultId: row.id,
    }));
  }

  discuss(id: string): NotificationLink {
    const root = this.deps.root();
    const row = this.deps.db.prepare(`SELECT ${columns} FROM workflow_results
      WHERE workspace = ? AND id = ? AND output = 'worth-a-look' AND ${active}`)
      .get(root, id, daysFrom(-14), nowIso()) as Row | undefined;
    if (!row || !this.deps.startDiscussion) throw new IpcFailure("not-found", "This item is no longer available.");
    const discussion = row.discussionId && this.deps.chatAvailable?.(row.discussionId)
      ? row.discussionId : this.deps.startDiscussion(view(row), row.projectId);
    this.deps.db.prepare("UPDATE workflow_results SET discussion_id = ? WHERE id = ? AND workspace = ?")
      .run(discussion, id, root);
    return { view: "explore", params: { chat: discussion } };
  }

  isDiscussion(sessionId: string): boolean {
    return !!this.deps.db.prepare(`SELECT 1 FROM workflow_results WHERE workspace = ? AND discussion_id = ?
      AND dismissed_at IS NULL AND decided_at IS NULL AND created_at > ?`)
      .get(this.deps.root(), sessionId, daysFrom(-14));
  }

  resolveDiscussion(sessionId: string, root: string): void {
    if (this.deps.root() !== root) return;
    const updated = this.deps.db.prepare(`UPDATE workflow_results SET decided_at = ?
      WHERE workspace = ? AND discussion_id = ? AND dismissed_at IS NULL AND decided_at IS NULL`)
      .run(nowIso(), root, sessionId);
    if (updated.changes) this.deps.changed();
  }

  later(id: string): void {
    this.deps.db.prepare(`UPDATE workflow_results SET later_until = ?
      WHERE id = ? AND workspace = ? AND output = 'worth-a-look' AND dismissed_at IS NULL AND decided_at IS NULL`)
      .run(daysFrom(7), id, this.deps.root());
    this.deps.changed();
  }

  dismiss(id: string): void {
    this.deps.db.prepare("UPDATE workflow_results SET dismissed_at = ? WHERE id = ? AND workspace = ?")
      .run(nowIso(), id, this.deps.root());
    this.deps.changed();
  }
}
