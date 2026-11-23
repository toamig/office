import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { isDeepStrictEqual } from "node:util";
import type { ToolEntry, ToolKind } from "../../../shared/tool-config";
import { notesPath } from "../vault/scope";

export type Value = Record<string, unknown>;
export interface Document {
  provider: ToolEntry["provider"];
  root: string;
  path: string;
  projectId: string | null;
  format: "json" | "toml";
  prefix?: string[];
  groups: Partial<Record<ToolKind, string>>;
}

export type Entry = Omit<ToolEntry, "title" | "description" | "configKey" | "command"> & {
  doc?: Document; storageKind?: ToolKind; key: string; value?: unknown;
  hook?: { group: number; index: number };
};

export const object = (value: unknown): Value =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Value : {};
export const read = (path: string): string | null => existsSync(path) ? readFileSync(path, "utf8") : null;
export const toolId = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

const claudeSettings = { plugin: "enabledPlugins", hook: "hooks" };
const codexSettings = { plugin: "plugins", mcp: "mcp_servers", connector: "apps", hook: "hooks" };

export function documents(home: string, project?: { id: string; folder: string }): Document[] {
  const list: Document[] = [];
  const add = (provider: Document["provider"], root: string, path: string, format: Document["format"],
    groups: Document["groups"], projectId: string | null, prefix?: string[]) => {
    const file = notesPath(root, path);
    if (file) list.push({ provider, root, path: file, format, groups, projectId, ...(prefix ? { prefix } : {}) });
  };
  add("claude-code", home, ".claude/settings.json", "json", claudeSettings, null);
  add("claude-code", home, ".claude.json", "json", { mcp: "mcpServers" }, null);
  add("codex", home, ".codex/config.toml", "toml", codexSettings, null);
  add("codex", home, ".codex/hooks.json", "json", { hook: "hooks" }, null);
  if (project) {
    const { id, folder } = project;
    add("claude-code", folder, ".claude/settings.json", "json", claudeSettings, id);
    add("claude-code", folder, ".claude/settings.local.json", "json", claudeSettings, id);
    add("claude-code", folder, ".mcp.json", "json", { mcp: "mcpServers" }, id);
    add("claude-code", home, ".claude.json", "json", { mcp: "mcpServers" }, id, ["projects", folder.replaceAll("\\", "/")]);
    add("codex", folder, ".codex/config.toml", "toml", codexSettings, id);
    add("codex", folder, ".codex/hooks.json", "json", { hook: "hooks" }, id);
  }
  return list;
}

function parse(format: Document["format"], text: string | null): Value {
  if (text === null) return {};
  const value: unknown = format === "json" ? JSON.parse(text.replace(/^\uFEFF/, "")) : parseToml(text.replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a configuration object.");
  return value as Value;
}

function nested(value: Value, path: string[], create = false): Value {
  for (const key of path) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid configuration key.");
    const current = Object.hasOwn(value, key) ? value[key] : undefined;
    if (create && current !== undefined && object(current) !== current)
      throw new Error(`The configuration key ${key} is not a table.`);
    value = create ? (value[key] = object(current)) as Value : object(current);
  }
  return value;
}

function entryKind(kind: ToolKind, value: unknown): ToolKind {
  return kind === "mcp" && typeof object(value)["url"] === "string" ? "connector" : kind;
}

export function docEntries(doc: Document): Entry[] {
  const value = nested(parse(doc.format, read(doc.path)), doc.prefix ?? []);
  const entries: Entry[] = [];
  for (const [kind, group] of Object.entries(doc.groups)) {
    for (const [key, valueOfEntry] of Object.entries(object(value[group]))) {
      if (kind === "hook" && Array.isArray(valueOfEntry)) {
        addHooks(entries, doc, key, valueOfEntry);
        continue;
      }
      const entry = object(valueOfEntry);
      entries.push({
        id: toolId(doc.path, doc.prefix, group, key), provider: doc.provider, doc,
        kind: entryKind(kind as ToolKind, valueOfEntry), name: key, path: doc.path,
        projectId: doc.projectId, disabled: valueOfEntry === false || entry["enabled"] === false,
        key, value: valueOfEntry, storageKind: kind as ToolKind,
      });
    }
  }
  if (typeof value["notify"] === "object" && Array.isArray(value["notify"]) && doc.format === "toml" && !doc.projectId) {
    entries.push({ id: toolId(doc.path, "notify"), provider: doc.provider, doc, kind: "hook",
      name: "Notify command", path: doc.path, projectId: null, disabled: false, key: "@notify", value: value["notify"] });
  }
  return entries;
}

function addHooks(entries: Entry[], doc: Document, event: string, groups: unknown[]): void {
  for (const [group, definition] of groups.entries()) {
    const hooks = object(definition)["hooks"];
    if (!Array.isArray(hooks)) continue;
    for (const [index, handler] of hooks.entries()) {
      const details = object(handler);
      const summary = details["command"] ?? details["tool"] ?? details["type"];
      entries.push({
        id: toolId(doc.path, event, group, index, handler),
        provider: doc.provider, doc, kind: "hook", name: event, path: doc.path,
        projectId: doc.projectId, disabled: false, key: event, hook: { group, index },
        ...(typeof summary === "string" ? { detail: summary.slice(0, 140) } : {}),
        value: groups,
      });
    }
  }
}

function headerGroup(line: string): string | undefined {
  return /^\s*\[\[?\s*([\w-]+)(?=[.\]\s])/.exec(line)?.[1];
}

function tomlEdit(before: string | null, group: string, next: Value): string {
  if (!before) return stringifyToml(next).trimEnd() + "\n";
  const lines = before.replace(/\r\n/g, "\n").split("\n");
  const retained: string[] = [];
  let drop = false;
  let table = false;
  for (const line of lines) {
    const header = headerGroup(line);
    if (header) { table = true; drop = header === group; }
    if (!table && new RegExp(`^\\s*${group}\\s*=`).test(line)) continue;
    if (!drop || /^\s*(#|$)/.test(line)) retained.push(line);
  }
  const changed = next[group] === undefined ? "" : stringifyToml({ [group]: next[group] });
  const body = retained.join("\n").trimEnd();
  const result = group === "notify" ? `${changed.trim()}\n${body}\n` : `${body}\n${changed.trimEnd()}\n`;
  if (!isDeepStrictEqual(parse("toml", result), parse("toml", stringifyToml(next)))) {
    throw new Error("This TOML layout needs a manual edit to preserve the rest of the file.");
  }
  return result;
}

export function editDoc(doc: Document, kind: ToolKind, key: string, before: string | null, value?: unknown): string {
  const root = parse(doc.format, before);
  const group = key === "@notify" ? "notify" : doc.groups[kind] ?? (kind === "connector" ? doc.groups.mcp : undefined);
  if (!group) throw new Error("This configuration does not support that tool.");
  if (key === "@notify") {
    delete root[group];
  } else {
    const section = nested(root, [...(doc.prefix ?? []), group], true);
    if (value === undefined) delete section[key];
    else Object.defineProperty(section, key, { value, writable: true, enumerable: true, configurable: true });
  }
  if (doc.format === "toml") return tomlEdit(before, group, root);
  const indent = /\n([ \t]+)"/.exec(before ?? "")?.[1] ?? "  ";
  return JSON.stringify(root, null, indent) + "\n";
}

export function skillsDir(home: string, provider: ToolEntry["provider"], project?: { folder: string }): string | null {
  const path = provider === "claude-code" ? ".claude/skills" : ".agents/skills";
  return notesPath(project?.folder ?? home, path);
}

export function skillsIn(dir: string | null, provider: ToolEntry["provider"], projectId: string | null): Entry[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    const skill = notesPath(dir, `${item.name}/SKILL.md`);
    if (!item.isDirectory() || !skill || !existsSync(skill)) return [];
    return [{ id: toolId(path), kind: "skill", provider, projectId, path,
      name: item.name, key: item.name, disabled: false }];
  });
}
