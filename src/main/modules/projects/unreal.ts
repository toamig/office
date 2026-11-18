import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The Unreal project file at the top of a project folder, or null when the folder is not an Unreal project. */
export function findUproject(folder: string): string | null {
  if (!existsSync(folder)) return null;
  try {
    const name = readdirSync(folder).find((f) => f.toLowerCase().endsWith(".uproject"));
    return name ? join(folder, name) : null;
  } catch {
    return null;
  }
}
