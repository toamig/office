export const migration020 = {
  id: 20,
  name: "usage",
  sql: `
    CREATE TABLE usage (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      day TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      kind TEXT NOT NULL,
      project_id TEXT,
      session_id TEXT,
      workflow_id TEXT,
      run_id TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      duration_ms INTEGER
    );
    CREATE INDEX usage_by_day ON usage (day);
    CREATE INDEX usage_by_session ON usage (session_id);
    CREATE INDEX usage_by_run ON usage (run_id);
    CREATE TABLE usage_limits (
      provider TEXT NOT NULL,
      window TEXT NOT NULL,
      label TEXT NOT NULL,
      utilization REAL NOT NULL,
      resets_at TEXT,
      status TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, window)
    );
  `,
};
