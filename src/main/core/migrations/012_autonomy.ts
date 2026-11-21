import type { Migration } from "./index";

export const migration012: Migration = {
  id: 12,
  name: "session autonomy",
  sql: "ALTER TABLE sessions ADD COLUMN autonomy TEXT",
};
