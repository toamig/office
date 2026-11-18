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
