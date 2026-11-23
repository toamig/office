import { randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ToolEdit, ToolEditPreview, ToolEntry, ToolKind } from "../../../shared/tool-config";
import { writeRawFile, writeTextFile } from "../../core/settings";
import { notesPath } from "../vault/scope";
import { unifiedDiff } from "./install-hooks";
import { splitCommand } from "./mcp-test";
import { describeEntry, installedPlugins } from "./tool-describe";
import { docEntries, documents, editDoc, type Entry, object, read, skillsDir, skillsIn, toolId } from "./tool-documents";

interface Deps {
  home: () => string;
  backups: () => string;
  project: (id: string) => string | undefined;
}

interface FileEdit { root: string; path: string; before: string | null; after: string }
interface DirectoryEdit {
  source: string; signature: string; copyTo?: string; archive?: string; destinationRoot: string;
}
interface Plan { expires: number; files: FileEdit[]; directories: DirectoryEdit[]; backup: string }

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,159}$/;

export class ToolConfigService {
  private readonly plans = new Map<string, Plan>();

  constructor(private readonly deps: Deps) {}

  private project(id?: string) {
    if (!id) return undefined;
    const folder = this.deps.project(id);
    if (!folder) throw new Error("That project has no local folder.");
    return { id, folder };
  }

  private entries(projectId?: string): Entry[] {
    const home = this.deps.home();
    const project = this.project(projectId);
    const settings = documents(home, project).flatMap((doc) => {
      try { return docEntries(doc); } catch { return []; }
    });
    for (const provider of ["claude-code", "codex"] as const) {
      settings.push(...skillsIn(skillsDir(home, provider), provider, null));
      if (project) settings.push(...skillsIn(skillsDir(home, provider, project), provider, project.id));
      if (provider === "codex") {
        settings.push(...skillsIn(notesPath(home, ".codex/skills"), provider, null));
        if (project) settings.push(...skillsIn(notesPath(project.folder, ".codex/skills"), provider, project.id));
      }
    }
    return settings;
  }

  list(projectId?: string): ToolEntry[] {
    const plugins = installedPlugins(this.deps.home());
    return this.entries(projectId).map((entry) => describeEntry(entry, plugins));
  }

  /** The configuration of a connection already in the list, for testing it. */
  connection(id: string, projectId?: string): { address?: string; command?: string; args: string[]; env: Record<string, string> } | null {
    const entry = this.entries(projectId).find((item) => item.id === id);
    if (!entry || (entry.kind !== "mcp" && entry.kind !== "connector")) return null;
    const config = object(entry.value);
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const env = Object.fromEntries(Object.entries(object(config["env"])).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
    if (typeof config["url"] === "string") return { address: config["url"], args: [], env };
    return typeof config["command"] === "string" ? { command: config["command"], args: strings(config["args"]), env } : null;
  }

  /** Plugins that are installed and not turned on yet, for the guided Add. */
  availablePlugins(provider: ToolEntry["provider"], projectId?: string): Array<{ id: string; title: string; description: string }> {
    if (provider !== "claude-code") return [];
    const on = new Set(this.entries(projectId).filter((entry) => entry.kind === "plugin" && !entry.disabled).map((entry) => entry.name));
    return [...installedPlugins(this.deps.home())].filter(([id]) => !on.has(id)).map(([id, plugin]) => ({ id, ...plugin }));
  }

  preview(request: ToolEdit): ToolEditPreview {
    const id = randomUUID();
    const plan: Plan = { expires: Date.now() + 600_000, files: [], directories: [], backup: join(this.deps.backups(), id) };
    if (request.action === "add") this.add(plan, request);
    else this.change(plan, request);
    for (const [key, pending] of this.plans)
      if (pending.expires < Date.now() || this.plans.size >= 50) this.plans.delete(key);
    this.plans.set(id, plan);
    return { id, changes: [
      ...plan.files.map((file) => ({
        path: file.path,
        diff: unifiedDiff(file.before ?? "", file.after),
      })),
      ...plan.directories.map((dir) => ({
        path: dir.source,
        diff: [
          dir.copyTo ? `+ Copy skill to ${dir.copyTo}` : "",
          dir.archive ? `- Remove from active skills and back up to ${dir.archive}` : "",
        ].filter(Boolean).join("\n"),
      })),
      ...(plan.files.some((file) => file.before !== null)
        ? [{ path: plan.backup, diff: "+ Back up originals before writing" }]
        : []),
    ] };
  }

  private change(plan: Plan, request: Exclude<ToolEdit, { action: "add" }>): void {
    const entry = this.entries(request.projectId).find((item) => item.id === request.id);
    if (!entry) throw new Error("That tool definition has changed. Refresh the list.");
    const project = request.action === "move" ? this.project(request.destination) : undefined;
    if (request.action === "move" && (!project || project.id === entry.projectId))
      throw new Error("Pick a different project for the move.");
    if (entry.kind === "skill") {
      this.skill(plan, entry.path, entry.provider, project, true);
      return;
    }
    if (!entry.doc) throw new Error("That tool has no editable configuration.");
    const kind = entry.storageKind ?? entry.kind;
    if (entry.hook) {
      const groups = structuredClone(entry.value) as Array<{ hooks: unknown[] }>;
      const group = groups[entry.hook.group]!;
      const [hook] = group.hooks.splice(entry.hook.index, 1);
      if (!group.hooks.length) groups.splice(entry.hook.group, 1);
      if (project) this.destination(plan, entry.provider, kind, entry.key, [{ ...group, hooks: [hook] }], project);
      this.file(plan, entry.doc, kind, entry.key, groups.length ? groups : undefined);
      return;
    }
    if (request.action === "move") {
      if (entry.key === "@notify") throw new Error("Codex only uses notify in user settings.");
      this.destination(plan, entry.provider, kind, entry.key, entry.value, project);
    }
    if (request.action === "enable") {
      this.file(plan, entry.doc, kind, entry.key, this.enabledValue(entry));
      return;
    }
    const disabled = request.action === "disable" ? this.disabledValue(entry) : undefined;
    this.file(plan, entry.doc, kind, entry.key, disabled);
  }

  private enabledValue(entry: Entry): unknown {
    if (!entry.disabled) throw new Error("That tool is already on.");
    if (entry.provider === "claude-code" && entry.kind === "plugin") return true;
    if (entry.provider === "codex" && entry.kind !== "hook") return { ...object(entry.value), enabled: true };
    throw new Error("This tool cannot be switched back on from here. Add it again instead.");
  }

  private disabledValue(entry: Entry): unknown {
    if (entry.provider === "claude-code" && entry.kind === "plugin") return false;
    if (entry.provider === "codex" && entry.kind !== "hook") return { ...object(entry.value), enabled: false };
    return undefined;
  }

  private add(plan: Plan, request: Extract<ToolEdit, { action: "add" }>): void {
    const project = this.project(request.projectId);
    if (request.kind === "skill") {
      if (!isAbsolute(request.value)) throw new Error("Choose the folder that contains SKILL.md.");
      this.skill(plan, resolve(request.value), request.provider, project, false);
      return;
    }
    if (!NAME.test(request.name)) throw new Error("Use a name with letters, numbers, dots, hyphens or an at sign.");
    const { provider, name, kind, value } = request;
    if (kind === "hook" && !value) throw new Error("Enter the hook command.");
    if (kind === "mcp" && !value) throw new Error("Enter the server executable.");
    if (kind === "connector" && !/^https?:\/\//i.test(value))
      throw new Error("Enter the connector's HTTP or HTTPS address.");
    const config = {
      hook: [{ hooks: [{ type: "command", command: value }] }],
      mcp: ((parts) => ({ command: parts[0] ?? value, ...(parts.length > 1 ? { args: parts.slice(1) } : {}) }))(splitCommand(value)),
      connector: provider === "codex" ? { url: value, enabled: true } : { type: "http", url: value },
      plugin: provider === "codex" ? { enabled: true } : true,
    }[kind];
    this.destination(plan, provider, kind === "connector" ? "mcp" : kind, name, config, project);
  }

  private destination(
    plan: Plan, provider: ToolEntry["provider"], kind: ToolKind, name: string, value: unknown,
    project: ReturnType<ToolConfigService["project"]>,
  ): void {
    const choices = documents(this.deps.home(), project).filter((doc) =>
      doc.provider === provider && doc.projectId === (project?.id ?? null) &&
      !doc.prefix && doc.groups[kind] && !doc.path.endsWith(".local.json"));
    const doc = kind === "hook" && provider === "codex" ? choices.at(-1) : choices[0];
    if (!doc) throw new Error("No safe configuration file was found for that tool.");
    const existing = docEntries(doc).find((item) => item.key === name && (item.storageKind ?? item.kind) === kind);
    if (existing && kind === "hook" && Array.isArray(existing.value) && Array.isArray(value)) {
      this.file(plan, doc, kind, name, [...existing.value, ...value]);
      return;
    }
    if (existing)
      throw new Error("A tool with that name is already defined there.");
    this.file(plan, doc, kind, name, value);
  }

  private file(plan: Plan, doc: NonNullable<Entry["doc"]>, kind: ToolKind, key: string, value: unknown): void {
    const before = read(doc.path);
    const after = editDoc(doc, kind, key, before, value);
    if (before !== after) plan.files.push({ root: doc.root, path: doc.path, before, after });
  }

  private skill(
    plan: Plan, source: string, provider: ToolEntry["provider"],
    project: ReturnType<ToolConfigService["project"]>, remove: boolean,
  ): void {
    const name = basename(source);
    const file = notesPath(source, "SKILL.md");
    if (!NAME.test(name) || lstatSync(source).isSymbolicLink() || !file || !existsSync(file))
      throw new Error("Choose a skill folder containing SKILL.md.");
    const dir = skillsDir(this.deps.home(), provider, project);
    const copies = !remove || project;
    const copyTo = copies && dir ? notesPath(dir, name) : null;
    if (copies && (!copyTo || existsSync(copyTo))) throw new Error("A skill with that folder name already exists there.");
    const archiveRoot = dirname(dirname(source));
    const archive = remove ? notesPath(archiveRoot, `.office-skill-backups/${name}-${randomUUID()}`) : null;
    if (remove && !archive) throw new Error("No safe backup location was found for the skill.");
    plan.directories.push({
      source, signature: toolId(read(file)), destinationRoot: project?.folder ?? this.deps.home(),
      ...(copyTo ? { copyTo } : {}), ...(archive ? { archive } : {}),
    });
  }

  apply(id: string): void {
    const plan = this.plans.get(id);
    this.plans.delete(id);
    if (!plan || plan.expires < Date.now()) throw new Error("Preview the change again before applying it.");
    for (const file of plan.files) {
      if (notesPath(file.root, relative(file.root, file.path)) !== file.path || read(file.path) !== file.before)
        throw new Error("The configuration changed after the preview. Preview it again.");
    }
    for (const dir of plan.directories) {
      const file = notesPath(dir.source, "SKILL.md");
      if (!file || lstatSync(dir.source).isSymbolicLink() || toolId(read(file)) !== dir.signature || (dir.copyTo && existsSync(dir.copyTo)))
        throw new Error("The skill changed after the preview. Preview it again.");
      const archiveRoot = dirname(dirname(dir.source));
      if ((dir.archive && notesPath(archiveRoot, relative(archiveRoot, dir.archive)) !== dir.archive)
        || (dir.copyTo && notesPath(dir.destinationRoot, relative(dir.destinationRoot, dir.copyTo)) !== dir.copyTo))
        throw new Error("A skill path is no longer safe. Preview it again.");
    }
    this.write(plan);
  }

  private write(plan: Plan): void {
    const changed: FileEdit[] = [];
    try {
      for (const [index, file] of plan.files.entries()) {
        if (file.before !== null) writeRawFile(join(plan.backup, `${index}-${basename(file.path)}`), file.before);
      }
      for (const file of plan.files) {
        writeTextFile(file.path, file.after);
        changed.push(file);
      }
      for (const dir of plan.directories) {
        this.writeSkill(dir);
      }
    } catch (error) {
      for (const file of changed.reverse()) {
        if (file.before === null) unlinkSync(file.path);
        else writeRawFile(file.path, file.before);
      }
      throw error;
    }
  }

  private writeSkill(dir: DirectoryEdit): void {
    const staged = dir.copyTo ? `${dir.copyTo}.office-copy-${randomUUID()}` : null;
    let archived = false;
    try {
      if (staged) {
        mkdirSync(dirname(staged), { recursive: true });
        cpSync(dir.source, staged, { recursive: true, force: false, errorOnExist: true,
          filter: (source) => !lstatSync(source).isSymbolicLink() });
      }
      if (dir.archive) {
        mkdirSync(dirname(dir.archive), { recursive: true });
        renameSync(dir.source, dir.archive);
        archived = true;
      }
      if (staged && dir.copyTo) renameSync(staged, dir.copyTo);
    } catch (error) {
      if (archived && dir.archive) renameSync(dir.archive, dir.source);
      if (staged) rmSync(staged, { recursive: true, force: true });
      throw error;
    }
  }
}
