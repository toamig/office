import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { OpenItemsView, WaitingEntry } from "../../../shared/models";
import type { Project, Workspace } from "../../../shared/types";
import type { Bus } from "../../core/bus";
import { parseOpenItems } from "./openitems";

export interface VaultServiceDeps {
  bus: Bus;
  workspace: () => Workspace | null;
  workspaceRoot: () => string;
}

interface CacheEntry {
  mtimeMs: number;
  view: OpenItemsView;
}

/** Reads each project's OpenItems file from the vault (cached by modification time). */
export class VaultService {
  private readonly cache = new Map<string, CacheEntry>();
  private watcher: FSWatcher | null = null;

  constructor(private readonly deps: VaultServiceDeps) {}

  private project(id: string): Project | undefined {
    return this.deps.workspace()?.projects.find((p) => p.id === id);
  }

  /** Absolute OpenItems path for a project, or null when the project or vault has none. */
  openItemsFile(projectId: string): string | null {
    const ws = this.deps.workspace();
    const project = this.project(projectId);
    if (!ws || !project || ws.vault.kind === "none" || project.vault === undefined) return null;
    return join(this.deps.workspaceRoot(), project.vault, ws.vault.openItemsFile);
  }

  read(projectId: string): OpenItemsView {
    const file = this.openItemsFile(projectId);
    const empty: OpenItemsView = {
      projectId,
      file,
      exists: false,
      waiting: [],
      unparsed: [],
      groups: [],
    };
    if (!file || !existsSync(file)) return empty;
    const mtimeMs = statSync(file).mtimeMs;
    const cached = this.cache.get(projectId);
    if (cached && cached.mtimeMs === mtimeMs) return cached.view;
    const heading = this.deps.workspace()?.vault.waitingHeading ?? "Waiting on you";
    const parsed = parseOpenItems(readFileSync(file, "utf8"), heading);
    const view: OpenItemsView = { projectId, file, exists: true, ...parsed };
    this.cache.set(projectId, { mtimeMs, view });
    return view;
  }

  waitingCount(projectId: string): number {
    return this.read(projectId).waiting.length;
  }

  /** Every waiting item of every non-archived project, newest first. */
  allWaiting(): WaitingEntry[] {
    const entries: WaitingEntry[] = [];
    for (const project of this.deps.workspace()?.projects ?? []) {
      if (project.archived) continue;
      for (const item of this.read(project.id).waiting) {
        entries.push({ ...item, projectId: project.id, projectName: project.name });
      }
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Watches the OpenItems files and emits `vault.changed` when one changes. */
  async watch(): Promise<void> {
    await this.unwatch();
    const files = (this.deps.workspace()?.projects ?? [])
      .map((p) => this.openItemsFile(p.id))
      .filter((f): f is string => f !== null);
    if (files.length === 0) return;
    this.watcher = chokidar.watch(files, { ignoreInitial: true });
    this.watcher.on("all", (_event, path) => {
      this.cache.clear();
      this.deps.bus.emit("vault.changed", { file: path });
    });
  }

  async unwatch(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
