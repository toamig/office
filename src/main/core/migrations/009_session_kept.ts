export const migration009 = {
  id: 9,
  name: "when the owner last kept an idle session",
  // "Still needed? Wrap up or keep": Keep restarts the idle timer from this moment.
  sql: `ALTER TABLE sessions ADD COLUMN kept_at TEXT;`,
};
