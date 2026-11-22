import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PendingItem } from "../../../shared/models";
import { dataDir } from "../../core/paths";
import { writeTextFile } from "../../core/settings";
import { git } from "../git/run";
import { unifiedDiff } from "../setup/install-hooks";
import { brainPath, readRulePack, RulePack } from "./rule-pack";

export const STARTER_FILES = [
  "Rules/rules.json", "Rules/AGENTS.md", "Rules/Authoring.md", "Rules/Templates.md",
  "Rules/Core.md", "Rules/Conventions.md", "Rules/tools/brain.mjs",
] as const;

export function detectRuleDomain(path: string): string | undefined {
  try {
    const files = readdirSync(path);
    if (files.some((file) => /\.uproject$/i.test(file))) return "unreal";
    if (files.some((file) => /\.(?:csproj|sln|slnx)$/i.test(file))) return "dotnet";
    return Object.entries({
      "package.json": "node", "Cargo.toml": "rust", "pyproject.toml": "python",
      "go.mod": "go", "pubspec.yaml": "dart", "project.godot": "godot",
    }).find(([file]) => files.includes(file))?.[1];
  } catch { return undefined; }
}

export async function commitStarterFiles(root: string, paths: string[], message: string): Promise<void> {
  if (!paths.length || (await git(root, ["rev-parse", "--show-toplevel"])).code !== 0) return;
  const add = await git(root, ["add", "-A", "--", ...paths]);
  const commit = add.code === 0 ? await git(root, ["commit", "-m", message, "--", ...paths]) : add;
  if (commit.code !== 0) throw new Error(commit.stderr.trim() || commit.stdout.trim());
  if ((await git(root, ["rev-parse", "--abbrev-ref", "@{u}"])).code === 0)
    await git(root, ["push", "--quiet"], { timeoutMs: 60_000 });
}
type StarterFile = typeof STARTER_FILES[number];
type Entry = { installed?: string; offered?: string; version?: number };
type Undo = { path: StarterFile; before: string; after: string; entry?: Entry };
type State = { files: Partial<Record<StarterFile, Entry>>; undo?: Undo[] };
type Change = { path: StarterFile; before: string; after: string; conflict: boolean; version: number };

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const read = (file: string | null): string | undefined =>
  file && existsSync(file) ? readFileSync(file, "utf8") : undefined;
const stateFile = (root: string, stateDir: string) => join(stateDir, `${hash(resolve(root))}.json`);
function loadState(root: string, stateDir: string): State {
  try { return JSON.parse(readFileSync(stateFile(root, stateDir), "utf8")) as State; }
  catch { return { files: {} }; }
}

function saveState(root: string, stateDir: string, state: State): void {
  writeTextFile(stateFile(root, stateDir), JSON.stringify(state) + "\n");
}

const starterStateDir = () => join(dataDir(), "starter-rule-packs");

export class StarterPack {
  constructor(
    private readonly root: string,
    private readonly template: string,
    private readonly folder: boolean,
    private readonly stateDir = starterStateDir(),
  ) {}

  private content(path: StarterFile): string {
    return readFileSync(join(this.template, path), "utf8");
  }

  private version(): number {
    return Number(RulePack.parse(JSON.parse(this.content("Rules/rules.json"))).source.split("@")[1]);
  }

  private file(path: StarterFile): string {
    const file = brainPath(this.root, path);
    if (!file) throw new Error(`${path} has no safe location inside the Brain.`);
    return file;
  }

  trackCreation(): void {
    const state: State = { files: {} };
    for (const path of STARTER_FILES) {
      const content = read(this.file(path));
      if (content !== undefined && content === this.content(path))
        state.files[path] = { installed: hash(content), version: this.version() };
    }
    saveState(this.root, this.stateDir, state);
  }

  status() {
    if (!this.root || !this.folder) return { add: [], conflicts: [], undo: [] };
    const state = loadState(this.root, this.stateDir);
    const rules = readRulePack(this.root);
    const missing = !rules && !read(brainPath(this.root, "Common/rules.json")) && !read(brainPath(this.root, "Rules/rules.json"));
    return {
      add: missing ? STARTER_FILES.filter((path) => !existsSync(this.file(path))) : [],
      conflicts: this.updates(state).filter((change) => change.conflict).map(({ path, before, after }) => ({
        path, before, after, diff: unifiedDiff(before.slice(0, 40_000), after.slice(0, 40_000)),
      })),
      undo: state.undo?.map((change) => change.path) ?? [],
    };
  }

  install(domains: string[]): string[] {
    const choices = this.status().add;
    if (!choices.length) throw new Error("The Brain already has a rule pack or is unavailable.");
    const state = loadState(this.root, this.stateDir);
    for (const path of choices) {
      const file = this.file(path);
      if (existsSync(file)) throw new Error(`${path} already exists. Review the file list again.`);
      const text = path === "Rules/rules.json" ? this.withDomains(this.content(path), domains) : this.content(path);
      writeTextFile(file, text);
      state.files[path] = { installed: hash(text), version: this.version() };
    }
    saveState(this.root, this.stateDir, state);
    return choices;
  }

  private withDomains(text: string, domains: string[]): string {
    const json = RulePack.parse(JSON.parse(text));
    const next = [...new Set([...(json.domains ?? []), ...domains])];
    return next.length === json.domains?.length ? text : JSON.stringify({ ...json, domains: next }, null, 2) + "\n";
  }

  private updates(state: State): Change[] {
    if (!this.folder || !this.root) return [];
    const pack = readRulePack(this.root);
    if (!pack?.source.startsWith("office-starter@")) return [];
    const version = Number(pack.source.split("@")[1]);
    const shipped = this.version();
    if (version > shipped) return [];
    // Compare the content too: an approved rules.json update may precede a decision about another file.
    return STARTER_FILES.flatMap((path): Change[] => {
      const entry = state.files[path];
      const existing = read(this.file(path));
      const raw = this.content(path);
      const after = path === "Rules/rules.json" ? this.withDomains(raw, pack.domains ?? []) : raw;
      const delivered = hash(after);
      if (existing === after || entry?.offered === delivered || (entry?.version ?? version) >= shipped) return [];
      return [{ path, before: existing ?? "", after, version: shipped,
        conflict: existing === undefined ? !!entry : hash(existing) !== entry?.installed }];
    });
  }

  refresh(): string[] {
    const state = loadState(this.root, this.stateDir);
    const changes = this.updates(state).filter((change) => !change.conflict);
    if (!changes.length) return [];
    state.undo = changes.map(({ path, before, after }) => ({ path, before, after, entry: state.files[path] }));
    for (const change of changes) this.use(change, state);
    saveState(this.root, this.stateDir, state);
    return changes.map((change) => change.path);
  }

  private use(change: Change, state: State): void {
    const file = this.file(change.path);
    if ((read(file) ?? "") !== change.before) throw new Error(`${change.path} changed. Review it again.`);
    writeTextFile(file, change.after);
    state.files[change.path] = { installed: hash(change.after), version: change.version };
  }

  answer(path: string, current: string, proposed: string, accept: boolean): string[] {
    const state = loadState(this.root, this.stateDir);
    const change = this.updates(state).find((entry) => entry.path === path && entry.before === current && entry.after === proposed);
    if (!change?.conflict) throw new Error("This rule update changed. Review it again.");
    if (accept) this.use(change, state);
    else state.files[change.path] = { ...state.files[change.path], offered: hash(change.after) };
    saveState(this.root, this.stateDir, state);
    return accept ? [change.path] : [];
  }

  undo(): string[] {
    const state = loadState(this.root, this.stateDir);
    const changes = state.undo ?? [];
    for (const change of changes)
      if (read(this.file(change.path)) !== change.after) throw new Error(`${change.path} changed after the update.`);
    for (const change of changes) {
      if (change.entry || change.before) writeTextFile(this.file(change.path), change.before);
      else rmSync(this.file(change.path), { force: true });
      state.files[change.path] = { ...change.entry, offered: hash(change.after) };
    }
    delete state.undo;
    saveState(this.root, this.stateDir, state);
    return changes.map((change) => change.path);
  }

  pending(): PendingItem[] {
    return this.status().conflicts.map(({ path, after }) => ({
      key: `starter-rules:${path}`, kind: "rule-update", severity: "attention",
      projectId: null, title: "Rules update available", detail: path,
      link: { view: "setup", params: { rules: path } }, fingerprint: hash(after),
    }));
  }
}

/** Adding notes in a newly detected domain extends only starter packs. */
export function registerStarterDomain(root: string, domain: string): boolean {
  const pack = readRulePack(root);
  if (!pack?.source.startsWith("office-starter@") || pack.domains?.includes(domain)) return false;
  const path = "Rules/rules.json";
  const file = brainPath(root, path);
  if (!file) return false;
  const stateDir = starterStateDir();
  const state = loadState(root, stateDir);
  const previous = read(file);
  const text = JSON.stringify({ ...pack, domains: [...(pack.domains ?? []), domain] }, null, 2) + "\n";
  writeTextFile(file, text);
  if (previous && state.files[path]?.installed === hash(previous)) {
    state.files[path] = { ...state.files[path], installed: hash(text) };
    saveState(root, stateDir, state);
  }
  return true;
}
