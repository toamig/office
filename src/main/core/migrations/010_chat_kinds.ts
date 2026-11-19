export const migration010 = {
  id: 10,
  name: "incognito and pinned chats",
  // An incognito chat has a row only while it is open (it is deleted on close and cleared at start); a pinned chat is
  // never archived for being idle.
  sql: `ALTER TABLE sessions ADD COLUMN incognito INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
};
