import type { Migration } from "./index";

export const migration016: Migration = {
  id: 16,
  name: "actionable workflow items",
  sql: `
    ALTER TABLE workflow_results ADD COLUMN workflow_name TEXT;
    ALTER TABLE workflow_results ADD COLUMN run_id TEXT;
    ALTER TABLE workflow_results ADD COLUMN project_ids TEXT;
    ALTER TABLE workflow_results ADD COLUMN sources TEXT;
    ALTER TABLE workflow_results ADD COLUMN first_step TEXT;
    ALTER TABLE workflow_results ADD COLUMN item_key TEXT;
    ALTER TABLE workflow_results ADD COLUMN later_until TEXT;
    ALTER TABLE workflow_results ADD COLUMN decided_at TEXT;
    ALTER TABLE workflow_results ADD COLUMN discussion_id TEXT;
    CREATE INDEX workflow_item_identity ON workflow_results (workspace, output, item_key);
    CREATE INDEX workflow_item_discussion ON workflow_results (workspace, discussion_id);
  `,
};
