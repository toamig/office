import type { Migration } from "./index";

export const migration014: Migration = {
  id: 14,
  name: "workflow results",
  sql: `
    ALTER TABLE automations_log ADD COLUMN workspace TEXT NOT NULL DEFAULT '';
    CREATE INDEX workflow_runs_by_workspace ON automations_log (workspace, automation, fired_at);
    CREATE TABLE workflow_results (
      id TEXT PRIMARY KEY, workspace TEXT NOT NULL, workflow_id TEXT NOT NULL,
      title TEXT NOT NULL, detail TEXT NOT NULL, project_id TEXT,
      output TEXT NOT NULL, created_at TEXT NOT NULL, dismissed_at TEXT
    );
    CREATE INDEX workflow_results_by_workspace ON workflow_results (workspace, output, created_at);
  `,
};
