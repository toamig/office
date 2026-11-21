import type { Migration } from "./index";

export const migration015: Migration = {
  id: 15,
  name: "workflow run outcomes",
  sql: `
    ALTER TABLE automations_log ADD COLUMN status TEXT;
    ALTER TABLE automations_log ADD COLUMN result TEXT;
  `,
};
