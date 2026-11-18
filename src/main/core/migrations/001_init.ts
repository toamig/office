export const migration001 = {
  id: 1,
  name: "init",
  sql: `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_session_id TEXT,
  project_id TEXT, cwd TEXT NOT NULL, branch TEXT, role TEXT, title TEXT,
  status TEXT NOT NULL,
  interactive INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  ended_at TEXT, archived_at TEXT, last_output_at TEXT
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT, project_id TEXT, task_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT, output_path TEXT, error TEXT
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT, title TEXT NOT NULL,
  body TEXT, link TEXT,
  urgent INTEGER NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pipeline TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL, branch TEXT, worktree TEXT, stage_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE task_stages (
  task_id TEXT NOT NULL, idx INTEGER NOT NULL, stage_id TEXT NOT NULL, role TEXT NOT NULL,
  status TEXT NOT NULL, run_id TEXT, session_id TEXT, output_path TEXT, approved_at TEXT,
  PRIMARY KEY (task_id, idx)
);
CREATE TABLE briefs (date TEXT NOT NULL, project_id TEXT NOT NULL, markdown TEXT NOT NULL,
  PRIMARY KEY (date, project_id));
CREATE TABLE layouts (project_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE automations_log (id TEXT PRIMARY KEY, automation TEXT NOT NULL, run_id TEXT,
  fired_at TEXT NOT NULL);
`,
};
