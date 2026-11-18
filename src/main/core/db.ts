import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { migrations, type Migration } from "./migrations";

export type Db = Database.Database;

/** Applies every migration that has not run yet, each in its own transaction. */
export function migrate(db: Db, list: Migration[] = migrations): number[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const done = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map(
      (r) => r.id,
    ),
  );
  const applied: number[] = [];
  for (const m of [...list].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    })();
    applied.push(m.id);
  }
  return applied;
}

/** Opens (creating if needed) the Office database and brings it up to date. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
