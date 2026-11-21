import type { Migration } from "./index";

export const migration013: Migration = {
  id: 13,
  name: "brain recorder",
  sql: `
    ALTER TABLE sessions ADD COLUMN brain_root TEXT;
    CREATE TABLE recorder_cursors (
      session_id TEXT PRIMARY KEY, cursor TEXT NOT NULL
    );
    CREATE TABLE recorder_proposals (
      id TEXT PRIMARY KEY, workspace TEXT NOT NULL, project_id TEXT, destination TEXT NOT NULL,
      text TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL
    );
    CREATE TABLE recorder_saves (
      id TEXT PRIMARY KEY, workspace TEXT NOT NULL, path TEXT NOT NULL, summary TEXT NOT NULL,
      git_commit TEXT NOT NULL, saved_at TEXT NOT NULL, undone_at TEXT
    );
    CREATE TABLE recorder_brief (
      workspace TEXT PRIMARY KEY, since TEXT NOT NULL, cutoff TEXT NOT NULL
    );
  `,
};
