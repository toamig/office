export const migration007 = {
  id: 7,
  name: "whether the provider conversation exists",
  // A real CLI refuses --session-id for a conversation that exists and --resume for one that does not, so the
  // session remembers whether a process for it ever ran. Terminals made before this ran, so they did.
  sql: `ALTER TABLE sessions ADD COLUMN conversation_started INTEGER NOT NULL DEFAULT 0;
UPDATE sessions SET conversation_started = 1 WHERE mode = 'terminal' AND provider != 'terminal';`,
};
