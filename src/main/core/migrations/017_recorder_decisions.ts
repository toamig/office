import type { Migration } from "./index";

export const migration017: Migration = {
  id: 17,
  name: "recorder decision context",
  sql: "ALTER TABLE recorder_proposals ADD COLUMN decision TEXT;",
};
