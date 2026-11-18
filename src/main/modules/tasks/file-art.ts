import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface FileArtInput {
  /** The Art vault folder from the settings; empty when the owner has not set one. */
  artVaultRoot: string;
  projectName: string;
  title: string;
  taskId: string;
  /** The task's own folder, where each stage wrote its output. */
  taskFolder: string;
}

export interface FileArtResult {
  folder: string | null;
  /** In words for the owner: where it went, or why it did not go anywhere. */
  note: string;
}

const safeName = (text: string): string =>
  [...text]
    .map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");

/**
 * Files a finished Art request into the Art vault: the task's folder (the brief, the review and anything
 * else the stages wrote there) is copied to `<art vault>/<project>/<title>/`. Art the Artist saved
 * somewhere else, as its brief told it to, stays where it is.
 */
export function fileArtTask(o: FileArtInput): FileArtResult {
  if (!o.artVaultRoot.trim()) {
    return {
      folder: null,
      note: "Not filed: set the Art vault folder in Preferences, then file it by hand or run the task again.",
    };
  }
  const project = safeName(o.projectName) || "Project";
  const name = safeName(o.title) || o.taskId.slice(0, 8);
  const parent = join(o.artVaultRoot, project);
  // Never write over an earlier request with the same title.
  const folder = existsSync(join(parent, name))
    ? join(parent, `${name} ${o.taskId.slice(0, 4)}`)
    : join(parent, name);
  try {
    mkdirSync(folder, { recursive: true });
    if (existsSync(o.taskFolder) && readdirSync(o.taskFolder).length > 0) {
      cpSync(o.taskFolder, folder, { recursive: true });
    }
    return { folder, note: `Filed in ${folder}.` };
  } catch (err) {
    return { folder: null, note: `Not filed: ${(err as Error).message}` };
  }
}
