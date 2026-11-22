import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { HealthView } from "../../../shared/models";
import { stripFrontmatter } from "../notes/notes";
import { parseValidate } from "./health";
import { notesPath, privateNotes, readText } from "./scope";
import { readRulePack } from "./rule-pack";

const BEGIN = "<!-- BEGIN GENERATED -->";
const END = "<!-- END GENERATED -->";
const IGNORED = new Set(["readme.md", "agents.md", "claude.md"]);
const DOMAINS = ["ue5", "saas", "webgames", "mobile", "meta"] as const;
const Metadata = z.object({
  type: z.enum(["contract", "reference", "patterns", "architecture", "overview", "openitems", "decisions",
    "conventions", "shared", "index", "spec", "roadmap", "design", "brand"]),
  domain: z.string().min(1),
  project: z.string().min(1).optional(),
  summary: z.string().trim().min(1).max(160),
  answers: z.array(z.string().trim().min(1)).min(1).max(5),
  tags: z.array(z.string()).max(6),
  authority: z.enum(["own", "derived"]),
  derived_from: z.array(z.string()).optional(),
}).strict();
type Metadata = z.infer<typeof Metadata>;

interface Note { path: string; text: string; metadata?: Metadata; error?: string }
export interface RouterEdit { path: string; before: string; initial: string; generated: string }

function readNote(root: string, path: string): Note {
  const text = readText(notesPath(root, path));
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  try {
    if (!frontmatter) throw new Error("Missing YAML frontmatter");
    const metadata = Metadata.parse(parse(frontmatter));
    return { path, text, metadata };
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")
      : (error as Error).message;
    return { path, text, error: message };
  }
}

function entries(root: string, folder: string) {
  try {
    return readdirSync(folder ? notesPath(root, folder) ?? "" : root, { withFileTypes: true });
  } catch {
    return [];
  }
}

function notePaths(root: string, folders: string[]): string[] {
  const seen = new Set<string>();
  const files = new Set<string>();
  const visit = (folder: string, recurse: boolean): void => {
    if (seen.has(folder)) return;
    seen.add(folder);
    for (const entry of entries(root, folder)) {
      const path = posix.join(folder, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "Archive" || entry.isSymbolicLink()) continue;
      if (recurse && entry.isDirectory()) visit(path, true);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") &&
          (!IGNORED.has(entry.name.toLowerCase()) || readText(notesPath(root, path)).startsWith("---")))
        files.add(path);
    }
  };
  visit("", false);
  for (const folder of ["Projects", "Shared", "General", "Rules", ...folders]) {
    if (notesPath(root, folder)) visit(folder.replaceAll("\\", "/"), true);
  }
  return [...files].sort((a, b) => a.localeCompare(b, "en"));
}

const headingKey = (value: string) => value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");

function badLinks(root: string, note: Note): string[] {
  const body = stripFrontmatter(note.text).replace(/^```.*$[\s\S]*?^```.*$/gm, "");
  const errors: string[] = [];
  for (const [, target, section] of body.matchAll(/\[\[([^\]|#]*)(?:#([^\]|]+))?(?:\|[^\]]+)?\]\]/g)) {
    const path = target ? /\.md$/i.test(target) ? target : `${target}.md` : note.path;
    const linked = readText(notesPath(root, path));
    if (!linked) errors.push(`Broken link [[${path}]]`);
    else if (section && ![...stripFrontmatter(linked).matchAll(/^#{1,6}\s+(.+)$/gm)].some(([, heading]) =>
      heading && headingKey(heading) === headingKey(section))) errors.push(`Missing heading [[${path}#${section}]]`);
  }
  return errors;
}

export function validateFolderBrain(root: string, folders: string[]): HealthView["validate"] {
  const notes = notePaths(root, folders).map((file) => readNote(root, file));
  const packs = readRulePack(root);
  const domains = new Set(packs?.domains ?? DOMAINS);
  const tags = packs?.tags ? new Set(packs.tags) : undefined;
  const errors = notes.flatMap((note) => {
    const issues = note.error ? [note.error] : badLinks(root, note);
    if (note.metadata && !domains.has(note.metadata.domain)) issues.push(`Unknown domain ${note.metadata.domain}`);
    if (tags) for (const tag of note.metadata?.tags ?? []) if (!tags.has(tag)) issues.push(`Unknown tag ${tag}`);
    if (note.metadata?.authority === "derived" && !note.metadata.derived_from?.length) issues.push("Derived notes need derived_from");
    if (note.metadata?.type === "index" && (!note.text.includes(BEGIN) || !note.text.includes(END)))
      issues.push("Router is missing the generated section");
    return issues.map((issue) => `ERROR ${note.path}: ${issue}`);
  });
  return parseValidate([...errors, `folder: ${notes.length} files, ${errors.length} errors, 0 warnings`].join("\n"), errors.length ? 1 : 0);
}

export function routerText(title: string, domain = "meta", project?: string): string {
  const summary = project ? `Where to find ${project.slice(0, 120)} notes by topic and purpose.` : "Where to find project notes and shared notes in the brain.";
  return `---\n${stringify({
    type: "index", domain, ...(project ? { project } : {}), summary, tags: ["routing"],
    answers: ["Where are these notes?", "Which file answers my question?"], authority: "own",
  })}---\n\n# ${title.replace(/\s+/g, " ")}\n\n${BEGIN}\n${END}\n`;
}

export function replaceGenerated(text: string, generated: string): string {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end <= start || start !== text.lastIndexOf(BEGIN) || end !== text.lastIndexOf(END))
    throw new Error("The router must contain one generated section.");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text.slice(0, start + BEGIN.length) + eol + generated.replace(/\n/g, eol) + text.slice(end);
}

function table(notes: Array<{ path: string; type: string; summary: string }>): string {
  if (!notes.length) return "";
  const rows = notes.map((note) =>
    `| [[${note.path.replace(/\.md$/i, "")}]] | ${note.type} | ${note.summary.replace(/\|/g, "\\|").replace(/\s+/g, " ")} |`);
  return ["", "| Note | Type | Purpose |", "| --- | --- | --- |", ...rows, "", ""].join("\n");
}

export function folderRouterEdits(root: string, folders: string[]): RouterEdit[] {
  const notes = notePaths(root, folders).map((file) => readNote(root, file));
  const byFolder = new Map<string, Note[]>();
  for (const note of notes) {
    const folder = posix.dirname(note.path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), note]);
  }
  const edits: RouterEdit[] = [];
  const routers: Array<{ path: string; type: string; summary: string }> = [];
  for (const [folder, group] of byFolder) {
    if (folder === ".") continue;
    const route = group.find((note) => note.path.endsWith("/_index.md"));
    const project = route?.metadata?.project ?? group.find((note) => note.metadata?.project)?.metadata?.project;
    const domain = route?.metadata?.domain ?? group.find((note) => note.metadata)?.metadata?.domain;
    const path = `${folder}/_index.md`;
    const initial = routerText(project ?? posix.basename(folder), domain, project);
    const tableRows = group.flatMap((note) => note.metadata && note.path !== path
      ? [{ path: note.path, type: note.metadata.type, summary: note.metadata.summary }] : []);
    if (!tableRows.length && !route) continue;
    edits.push({ path, before: route?.text ?? "", initial, generated: table(tableRows) });
    if (!privateNotes(root, folder))
      routers.push({ path, type: "index", summary: route?.metadata?.summary ?? `Notes in ${project ?? folder}.` });
  }
  const rootNotes = byFolder.get(".") ?? [];
  const rootRouter = rootNotes.find((note) => note.path === "_index.md");
  routers.push(...rootNotes.flatMap((note) => note.metadata && note.path !== "_index.md"
    ? [{ path: note.path, type: note.metadata.type, summary: note.metadata.summary }] : []));
  edits.push({ path: "_index.md", before: rootRouter?.text ?? "", initial: routerText("Brain"), generated: table(routers) });
  return edits;
}
