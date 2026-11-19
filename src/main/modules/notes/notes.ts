import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NoteEntry, ProjectNote, SearchItem } from "../../../shared/models";
import { isRareNote } from "../../../shared/notes";
import type { Workspace } from "../../../shared/types";

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** The value of one frontmatter key (`summary`, `type`), without quotes; null when absent. */
export function frontmatterValue(markdown: string, key: string): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") return null;
    const m = new RegExp(`^${key}:\\s*(.*)$`).exec(line);
    if (m) return (m[1] ?? "").trim().replace(/^["']|["']$/g, "") || null;
  }
  return null;
}

/** Removes a leading YAML frontmatter block. */
export function stripFrontmatter(markdown: string): string {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return markdown;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---")
      return lines
        .slice(i + 1)
        .join("\n")
        .replace(/^\s*\n/, "");
  }
  return markdown;
}

function vaultDir(ws: Workspace | null, root: string, projectId: string): string | null {
  const project = ws?.projects.find((p) => p.id === projectId);
  if (!ws || ws.vault.kind === "none" || project?.vault === undefined) return null;
  return join(root, project.vault);
}

/** Reads one note (Overview, OpenItems, ...) of a project's vault folder. */
export function readNote(
  ws: Workspace | null,
  root: string,
  projectId: string,
  name: string,
): ProjectNote {
  const clean = name.replace(/\.md$/i, "");
  const missing: ProjectNote = {
    projectId,
    name: clean,
    exists: false,
    markdown: "",
    summary: null,
    source: "",
  };
  const dir = vaultDir(ws, root, projectId);
  if (!dir || !NAME_RE.test(clean)) return missing;
  const file = join(dir, `${clean}.md`);
  if (!existsSync(file)) return missing;
  const text = readFileSync(file, "utf8");
  const folder = ws?.projects.find((p) => p.id === projectId)?.vault ?? "";
  return {
    projectId,
    name: clean,
    exists: true,
    markdown: stripFrontmatter(text),
    summary: frontmatterValue(text, "summary"),
    source: `${folder}/${clean}.md`,
  };
}

/** Every note of a project with its own summary, for the list; audits and implementation notes are marked rare. */
export function noteEntries(ws: Workspace | null, root: string, projectId: string): NoteEntry[] {
  const dir = vaultDir(ws, root, projectId);
  return listNotes(ws, root, projectId).map((name) => {
    let text = "";
    try {
      text = readFileSync(join(dir ?? "", `${name}.md`), "utf8");
    } catch {
      /* an unreadable note is listed without a summary */
    }
    return {
      name,
      summary: frontmatterValue(text, "summary"),
      rare: isRareNote(name, frontmatterValue(text, "type")),
    };
  });
}

/** The absolute path of a note's file, or null when it is not there. */
export function notePath(
  ws: Workspace | null,
  root: string,
  projectId: string,
  name: string,
): string | null {
  const clean = name.replace(/\.md$/i, "");
  const dir = vaultDir(ws, root, projectId);
  if (!dir || !NAME_RE.test(clean)) return null;
  const file = join(dir, `${clean}.md`);
  return existsSync(file) ? file : null;
}

/** Top-level markdown notes in a project's vault folder, for the quick switcher. */
export function listNotes(ws: Workspace | null, root: string, projectId: string): string[] {
  const dir = vaultDir(ws, root, projectId);
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

/** Switcher items for projects and their notes. Other modules add branches, worktrees, sessions. */
export function noteAndProjectItems(ws: Workspace | null, root: string): SearchItem[] {
  const items: SearchItem[] = [];
  for (const p of ws?.projects ?? []) {
    if (p.archived) continue;
    items.push({
      kind: "project",
      label: p.name,
      ...(p.group ? { detail: p.group } : {}),
      link: { view: "project", params: { id: p.id } },
    });
    for (const note of listNotes(ws, root, p.id)) {
      items.push({
        kind: "note",
        label: `${p.name}: ${note}`,
        link: { view: "project", params: { id: p.id, tab: "notes", note } },
      });
    }
  }
  return items;
}
