export const migration004 = {
  id: 4,
  name: "task hand-off record",
  sql: `ALTER TABLE tasks ADD COLUMN recorded_at TEXT;`,
};
