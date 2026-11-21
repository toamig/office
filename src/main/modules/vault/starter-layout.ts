import { existsSync } from "node:fs";
import { writeTextFile } from "../../core/settings";
import { git } from "../git/run";
import { folderRouterEdits, replaceGenerated, routerText } from "./folder-brain";
import { NOTE_LAYOUT, type NoteDestination, starterNote } from "./note-layout";
import { notesPath } from "./scope";

const TOPICS: NoteDestination[] = [
  "overview", "decision", "waiting", "architecture", "contract", "design",
  "audience", "reference", "journal", "lesson",
];

export const projectNoteNames = TOPICS.map((topic) => NOTE_LAYOUT[topic].file);

function create(root: string, path: string, contents: string): void {
  const file = notesPath(root, path);
  if (!file) throw new Error("No safe location was found for the note.");
  if (!existsSync(file)) writeTextFile(file, contents);
}

export function writeStarterBrain(root: string): void {
  create(root, "General/Journal.md", starterNote("journal", "General"));
  create(root, "General/References.md", starterNote("reference", "General"));
  create(root, "Shared/OwnerProfile.md", starterNote("profile"));
  for (const edit of folderRouterEdits(root, [])) {
    const text = replaceGenerated(edit.before || edit.initial, edit.generated);
    create(root, edit.path, text);
  }
}

export function writeProjectLayout(
  root: string,
  folder: string,
  name: string,
  domain: string,
  options: { overview?: string; waitingHeading?: string; hub?: boolean } = {},
): void {
  const route = `${folder}/_index.md`;
  create(root, route, routerText(name, domain, name));
  if (!options.hub) create(root, `${folder}/brain.json`, JSON.stringify({
    folder, private: false, depends: [{ folder: "Shared" }],
  }, null, 2) + "\n");
  for (const topic of TOPICS) {
    const { file, heading } = NOTE_LAYOUT[topic];
    let text = starterNote(topic, name, domain);
    if (topic === "overview" && options.overview) text += `\n${options.overview}\n`;
    if (topic === "waiting") {
      if (options.waitingHeading) text = text.replace(`## ${heading}\n`, `## ${options.waitingHeading}\n`);
      text += "\n## Open items\n";
    }
    create(root, `${folder}/${file}`, text);
  }
  const index = folderRouterEdits(root, [folder]).find((item) => item.path === route);
  const indexPath = notesPath(root, route);
  if (index && indexPath) writeTextFile(indexPath, replaceGenerated(index.before, index.generated));
}

/** Include the root router in a new project commit when it has no local edits. */
export async function updateStarterRouter(root: string, folders: string[]): Promise<boolean> {
  const path = notesPath(root, "_index.md");
  if (!path) return false;
  const dirty = await git(root, ["status", "--porcelain", "--", "_index.md"]);
  if (dirty.code !== 0 || dirty.stdout.trim()) return false;
  const edit = folderRouterEdits(root, folders).find((candidate) => candidate.path === "_index.md");
  if (!edit) return false;
  const output = replaceGenerated(edit.before || edit.initial, edit.generated);
  if (output === edit.before) return false;
  writeTextFile(path, output);
  return true;
}
