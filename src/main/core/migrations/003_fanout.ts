export const migration003 = {
  id: 3,
  name: "task fan-out",
  sql: `
ALTER TABLE tasks ADD COLUMN fanout INTEGER NOT NULL DEFAULT 1;
CREATE TABLE task_variants (
  task_id TEXT NOT NULL, stage_idx INTEGER NOT NULL, n INTEGER NOT NULL,
  branch TEXT NOT NULL, worktree TEXT NOT NULL, run_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY (task_id, stage_idx, n)
);
`,
};
