export const migration022 = {
  id: 22,
  name: "cloud_runs",
  sql: `
    CREATE TABLE cloud_runs (
      session_id TEXT PRIMARY KEY,
      trigger_id TEXT NOT NULL,
      routine_name TEXT NOT NULL,
      project_id TEXT,
      state TEXT NOT NULL,
      fired_at TEXT,
      finished_at TEXT,
      seconds INTEGER,
      failure TEXT,
      url TEXT,
      excerpt TEXT,
      sent_to TEXT NOT NULL,
      reported_at TEXT NOT NULL
    );
    CREATE INDEX cloud_runs_by_time ON cloud_runs (reported_at);
    CREATE INDEX cloud_runs_by_project ON cloud_runs (project_id, reported_at);
  `,
};
