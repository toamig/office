export const migration019 = {
  id: 19,
  name: "workflow_late",
  sql: "ALTER TABLE automations_log ADD COLUMN late_for TEXT",
};
