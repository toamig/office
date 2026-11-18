export const migration005 = {
  id: 5,
  name: "task base branch",
  sql: `ALTER TABLE tasks ADD COLUMN base_branch TEXT;`,
};
