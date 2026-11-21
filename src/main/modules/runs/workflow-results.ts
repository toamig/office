import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PendingItem } from "../../../shared/models";
import type { Workflow, WorkflowResult } from "../../../shared/workflow";
import type { Db } from "../../core/db";
import { nowIso } from "../../core/util";

const Ideas = z.object({ ideas: z.array(z.object({
  title: z.string().trim().min(1), detail: z.string().trim().default(""),
})) });

export function workflowIdeas(text: string): Array<{ title: string; detail: string }> {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  try {
    return Ideas.parse(JSON.parse(fenced?.[1] ?? text)).ideas.slice(0, 5).map((idea) => ({
      title: idea.title.slice(0, 160), detail: idea.detail.slice(0, 3000),
    }));
  } catch {
    return text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
      .filter(Boolean).slice(0, 5).map((title) => ({ title: title.slice(0, 160), detail: "" }));
  }
}

export class WorkflowResults {
  constructor(private readonly deps: {
    db: Db; root: () => string; changed: () => void;
    saveNote: (projectId: string | null, text: string) => Promise<void>;
  }) {}

  async save(root: string, workflow: Workflow, text: string): Promise<void> {
    if (this.deps.root() !== root || !text.trim()) return;
    if (workflow.output === "note") {
      await this.deps.saveNote(workflow.projectId, text.trim().slice(0, 6000));
      return;
    }
    const rows = workflow.output === "pending"
      ? [{ title: workflow.name, detail: text.trim().slice(0, 3000) }]
      : workflowIdeas(text);
    const insert = this.deps.db.prepare(`INSERT INTO workflow_results
      (id, workspace, workflow_id, title, detail, project_id, output, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    this.deps.db.transaction(() => {
      for (const row of rows)
        insert.run(randomUUID(), root, workflow.id, row.title, row.detail, workflow.projectId, workflow.output, nowIso());
    })();
    this.deps.changed();
  }

  list(output: Workflow["output"] = "worth-a-look"): WorkflowResult[] {
    return this.deps.db.prepare(`SELECT id, title, detail, project_id AS projectId FROM workflow_results
      WHERE workspace = ? AND output = ? AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 50`)
      .all(this.deps.root(), output) as WorkflowResult[];
  }

  pending(): PendingItem[] {
    return this.list("pending").map((row) => ({
      key: `workflow:${row.id}`, kind: "workflow", severity: "attention",
      projectId: row.projectId, title: row.title, detail: row.detail,
      link: row.projectId ? { view: "project", params: { id: row.projectId } } : { view: "home" },
      fingerprint: row.id, workflowResultId: row.id,
    }));
  }

  get(id: string): WorkflowResult | undefined {
    return this.deps.db.prepare(`SELECT id, title, detail, project_id AS projectId FROM workflow_results
      WHERE id = ? AND workspace = ? AND dismissed_at IS NULL`).get(id, this.deps.root()) as WorkflowResult | undefined;
  }

  dismiss(id: string): void {
    this.deps.db.prepare("UPDATE workflow_results SET dismissed_at = ? WHERE id = ? AND workspace = ?")
      .run(nowIso(), id, this.deps.root());
    this.deps.changed();
  }
}
