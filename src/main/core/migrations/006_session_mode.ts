export const migration006 = {
  id: 6,
  name: "session mode (chat or terminal)",
  sql: `ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'terminal';`,
};
