export const migration002 = {
  id: 2,
  name: "session capture marker",
  sql: `ALTER TABLE sessions ADD COLUMN captured_at TEXT;`,
};
