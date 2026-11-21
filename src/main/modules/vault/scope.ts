import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Workspace } from "../../../shared/types";
import { frontmatterValue, stripFrontmatter } from "../notes/notes";
import { readHub } from "./hub";

export interface BrainScope {
  root: string;
  instructions: string;
  writable: string[];
  readOnly: string[];
  private: string[];
}

/** Returns a path below the root. Rejects traversal and junctions on every existing component. */
export function notesPath(root: string, path: string): string | null {
  if (!root || !path || isAbsolute(path) || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => part === ".." || part.includes(":"))) return null;
  const base = resolve(root);
  const target = resolve(base, ...parts);
  const rel = relative(base, target);
  if (!rel || isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === "..") return null;
  let current = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      break;
    }
  }
  return target;
}

export function readText(file: string | null): string {
  if (!file) return "";
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export const profilePath = (kind: string): string =>
  kind === "brain-hub" ? "Common/OwnerProfile.md" : "Shared/OwnerProfile.md";

export function privateNotes(root: string, folder: string): boolean {
  try {
    const data: unknown = JSON.parse(readText(notesPath(root, `${folder}/brain.json`)));
    return typeof data === "object" && data !== null && "private" in data && data.private === true;
  } catch {
    return false;
  }
}

function tailEntries(markdown: string, count: number): string {
  const body = stripFrontmatter(markdown);
  const entries = body.split(/(?=^#{2,3} |^- )/m).map((text) => text.trim()).filter(Boolean);
  return entries.filter((part) => /^(#{2,3} |[-] )/.test(part)).slice(-count).join("\n");
}

function packPart(label: string, content: string, characters: number): string {
  const text = Buffer.from(content.trim()).subarray(0, characters).toString("utf8").replace(/\uFFFD$/, "");
  return text ? `${label}\n${text}` : "";
}

export function brainScope(ws: Workspace | null, root: string, projectId?: string): BrainScope | undefined {
  if (!ws || !root || ws.vault.kind === "none") return undefined;
  const project = ws.projects.find((entry) => entry.id === projectId);
  const folder = project?.vault;
  const owner = folder === undefined ? null : notesPath(root, folder);
  const folders = new Set([
    ...readHub(root).map((repo) => repo.folder),
    ...ws.projects.flatMap((entry) => entry.vault === undefined ? [] : [entry.vault]),
    "Shared", "Common", "General",
  ]);
  const scope: BrainScope = { root, instructions: "", writable: owner ? [owner] : [], readOnly: [], private: [] };
  for (const name of folders) {
    const target = notesPath(root, name);
    if (!target || target === owner || owner?.startsWith(target + sep)) continue;
    (privateNotes(root, name) ? scope.private : scope.readOnly).push(target);
  }
  const read = (name: string) => !owner || folder === undefined ? "" : readText(notesPath(root, `${folder}/${name}`));
  const overview = read("Overview.md");
  scope.instructions = [
    "Brain context. Read the root router and then the project's router. Open the one file that answers the question. Do not scan the Brain.",
    `Root router: ${join(root, "_index.md")}`,
    owner ? `Your notes: ${owner}. Write only in this notes folder.` : "Brain notes are read-only in this conversation.",
    "You may read declared dependencies and use the routers to find other public notes. Never read another project's private notes, even if a router names them.",
    packPart("Project overview", frontmatterValue(overview, "summary") ?? stripFrontmatter(overview), 450),
    packPart("Open items", stripFrontmatter(read(ws.vault.openItemsFile)), 850),
    packPart("Recent decisions", tailEntries(read("Decisions.md"), 5), 850),
    packPart("Project lessons", stripFrontmatter(read("Lessons.md")), 600),
    packPart("Owner profile", stripFrontmatter(readText(notesPath(root, profilePath(ws.vault.kind)))), 650),
  ].filter(Boolean).join("\n\n");
  return scope;
}
