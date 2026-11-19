import { Layout } from "../../../shared/models";
import type { Layout as LayoutType } from "../../../shared/models";
import type { Db } from "../../core/db";

/** The tab and split layout of the Agents view, saved per project (key "all" for the global view). */
export function getLayout(db: Db, key: string): LayoutType | null {
  const row = db.prepare("SELECT json FROM layouts WHERE project_id = ?").get(key) as
    { json: string } | undefined;
  if (!row) return null;
  try {
    return Layout.parse(JSON.parse(row.json));
  } catch {
    return null;
  }
}

export function setLayout(db: Db, key: string, layout: LayoutType): void {
  db.prepare(
    "INSERT INTO layouts (project_id, json) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET json = excluded.json",
  ).run(key, JSON.stringify(layout));
}

/** The layout of a docked workbench, as the JSON the dock library wrote: saved per workbench and project, and by name. */
export function getDock(db: Db, key: string): string | null {
  const row = db.prepare("SELECT json FROM layouts WHERE project_id = ?").get(`dock:${key}`) as
    { json: string } | undefined;
  return row?.json ?? null;
}

export function setDock(db: Db, key: string, json: string): void {
  db.prepare(
    "INSERT INTO layouts (project_id, json) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET json = excluded.json",
  ).run(`dock:${key}`, json);
}

/** The keys that start with `prefix`, without the storage prefix, in the order they sort. */
export function listDock(db: Db, prefix: string): string[] {
  const rows = db
    .prepare(
      "SELECT project_id FROM layouts WHERE project_id LIKE ? ESCAPE '\\' ORDER BY project_id",
    )
    .all(`dock:${prefix.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) as Array<{ project_id: string }>;
  return rows.map((r) => r.project_id.slice("dock:".length));
}

export function removeDock(db: Db, key: string): void {
  db.prepare("DELETE FROM layouts WHERE project_id = ?").run(`dock:${key}`);
}
