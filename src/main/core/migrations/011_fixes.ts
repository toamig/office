export const migration011 = {
  id: 11,
  name: "which session is fixing which problem",
  // A problem Office shows (a pending item, a health item) that has a Fix session says "Being fixed in <session>".
  sql: `CREATE TABLE fixes (
  key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  started_at TEXT NOT NULL
);`,
};
