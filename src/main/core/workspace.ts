import { readFileSync } from "node:fs";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { Workspace as WorkspaceSchema } from "../../shared/schemas";
import type { Workspace } from "../../shared/types";
import { writeTextFile } from "./settings";

export type WorkspaceLoad = { ok: true; workspace: Workspace } | { ok: false; error: string };

/** Reads and validates a workspace config file. Never throws. */
export function loadWorkspaceFile(path: string): WorkspaceLoad {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, error: `Cannot read ${path}: ${(err as Error).message}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (err) {
    return { ok: false, error: `Invalid JSON in ${path}: ${(err as Error).message}` };
  }
  const parsed = WorkspaceSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Workspace config failed validation: ${issues}` };
  }
  return { ok: true, workspace: parsed.data };
}

export interface WorkspaceState {
  workspace: Workspace | null;
  error: string | null;
}

type Listener = (state: WorkspaceState) => void;

/** Holds the workspace config, reloads it when the file changes, keeps the last good copy. */
export class WorkspaceStore {
  private good: Workspace | null = null;
  private error: string | null = null;
  private watcher: FSWatcher | null = null;
  private readonly listeners = new Set<Listener>();
  private path = "";

  get state(): WorkspaceState {
    return { workspace: this.good, error: this.error };
  }

  get filePath(): string {
    return this.path;
  }

  /** Points the store at a config file, loads it and starts watching it. */
  async open(workspaceRoot: string, configPath: string): Promise<void> {
    await this.close();
    this.path = join(workspaceRoot, configPath);
    this.reload();
    this.watcher = chokidar.watch(this.path, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
    });
    this.watcher.on("add", () => this.reload());
    this.watcher.on("change", () => this.reload());
    await new Promise<void>((done) => this.watcher?.once("ready", () => done()));
  }

  async close(): Promise<void> {
    if (this.watcher) await this.watcher.close();
    this.watcher = null;
  }

  /** Re-reads the file now. An invalid file keeps the last good copy and sets an error. */
  reload(): WorkspaceState {
    const result = loadWorkspaceFile(this.path);
    if (result.ok) {
      this.good = result.workspace;
      this.error = null;
    } else {
      this.error = result.error;
    }
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Takes a validated config as the current one right away, without waiting for the watcher or a reload.
   * The editor calls it as it writes, so anything that reads the store sees the change at once.
   */
  adopt(next: Workspace): void {
    this.good = next;
    this.error = null;
    for (const listener of this.listeners) listener(this.state);
  }

  /** Validates and writes a new config. Used by editing UIs; the watcher then reloads. */
  save(next: Workspace): void {
    const parsed = WorkspaceSchema.parse(next);
    writeTextFile(this.path, `${JSON.stringify(parsed, null, 2)}\n`);
    this.reload();
  }
}
