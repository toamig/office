export const migration021 = {
  id: 21,
  name: "session_recaps",
  sql: `
    CREATE TABLE session_recaps (
      session_id TEXT PRIMARY KEY,
      project_id TEXT,
      at TEXT NOT NULL,
      asked TEXT NOT NULL,
      done TEXT NOT NULL,
      unfinished TEXT NOT NULL,
      next_step TEXT
    );
    CREATE INDEX session_recaps_by_time ON session_recaps (at);
  `,
};
