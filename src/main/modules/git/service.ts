import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { LastCommit, ProjectDetail, ProjectSummary, RepoStatus } from "../../../shared/models";
import type { Project } from "../../../shared/types";
import type { Bus } from "../../core/bus";
import { debounce, mapLimit, nowIso } from "../../core/util";
import { isGitFolder, readLastCommit, readOrigin, readStatus } from "./status";

export interface ProjectServiceDeps {
  bus: Bus;
  projects: () => Project[];
  projectsRoot: () => string;
  /** Number of "Waiting on you" items for a project (the vault module provides it). */
  waiting?: (projectId: string) => number;
}

interface Cached {
  status: RepoStatus | null;
  lastCommit: LastCommit | null;
  origin: string | null;
  error?: string;
  at: string;
}

const FIVE_MINUTES = 5 * 60 * 1000;
/** A cached read older than this is refreshed behind the answer that returns it. */
const STALE_MS = 15_000;

/** Reads and caches the git state of every project, and refreshes it by the rules of plan section 10. */
export class ProjectService {
  private readonly cache = new Map<string, Cached>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: ProjectServiceDeps) {}

  absPath(project: Project): string {
    return resolve(this.deps.projectsRoot(), project.path);
  }

  find(id: string): Project | undefined {
    return this.deps.projects().find((p) => p.id === id);
  }

  /** Summaries from the cache; call refreshAll() first for fresh data. */
  list(): ProjectSummary[] {
    return this.deps.projects().map((p) => this.summarize(p));
  }

  /**
   * The project as last read. Git is only asked here for a project that was never read; otherwise the cached
   * answer comes back at once and, when it is old, a refresh runs behind it and announces itself with an event.
   */
  async get(id: string): Promise<ProjectDetail | null> {
    const project = this.find(id);
    if (!project) return null;
    let cached = this.cache.get(id);
    if (!cached) {
      await this.refresh(id);
      cached = this.cache.get(id);
    } else if (Date.now() - Date.parse(cached.at) > STALE_MS) {
      void this.refresh(id);
    }
    return {
      summary: this.summarize(project),
      status: cached?.status ?? null,
      lastCommit: cached?.lastCommit ?? null,
      origin: cached?.origin ?? null,
    };
  }

  /** Reads the project's git state now. A read already under way is shared, never repeated. */
  refresh(id: string): Promise<void> {
    const running = this.inflight.get(id);
    if (running) return running;
    const work = this.read(id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, work);
    return work;
  }

  private async read(id: string): Promise<void> {
    const project = this.find(id);
    if (!project) return;
    const path = this.absPath(project);
    let entry: Cached;
    if (!existsSync(path) || !isGitFolder(path)) {
      entry = { status: null, lastCommit: null, origin: null, at: nowIso() };
    } else {
      const status = await readStatus(path);
      entry = status.ok
        ? {
            status: status.status,
            lastCommit: await readLastCommit(path),
            origin: await readOrigin(path),
            at: nowIso(),
          }
        : { status: null, lastCommit: null, origin: null, error: status.error, at: nowIso() };
    }
    this.cache.set(id, entry);
    this.deps.bus.emit("project.status", { projectId: id }, id);
  }

  async refreshAll(): Promise<void> {
    const active = this.deps.projects().filter((p) => !p.archived);
    await mapLimit(active, 4, (p) => this.refresh(p.id));
  }

  /** Starts the 5-minute timer and the file watchers. */
  startAuto(): void {
    this.stopAuto();
    this.timer = setInterval(() => void this.refreshAll(), FIVE_MINUTES);
    for (const project of this.deps.projects()) {
      if (project.archived) continue;
      const git = join(this.absPath(project), ".git");
      if (!existsSync(join(git, "HEAD"))) continue;
      const refresh = debounce(() => void this.refresh(project.id), 1000);
      const watcher = chokidar.watch([join(git, "HEAD"), join(git, "index"), join(git, "refs")], {
        ignoreInitial: true,
      });
      watcher.on("all", refresh);
      this.watchers.set(project.id, watcher);
    }
  }

  stopAuto(): void {
    clearInterval(this.timer);
    for (const watcher of this.watchers.values()) void watcher.close();
    this.watchers.clear();
  }

  private summarize(project: Project): ProjectSummary {
    const path = this.absPath(project);
    const cached = this.cache.get(project.id);
    const status = cached?.status ?? null;
    return {
      id: project.id,
      name: project.name,
      ...(project.group ? { group: project.group } : {}),
      pinned: project.pinned,
      archived: project.archived,
      path,
      exists: existsSync(path),
      isRepo: status !== null,
      branch: status?.branch ?? null,
      detached: status?.detached ?? false,
      upstream: status?.upstream ?? null,
      changed: status?.files.length ?? 0,
      ahead: status?.ahead ?? 0,
      behind: status?.behind ?? 0,
      waiting: this.deps.waiting?.(project.id) ?? 0,
      lastActivity: cached?.lastCommit?.date ?? null,
      statusAt: cached?.at ?? null,
      ...(cached?.error ? { error: cached.error } : {}),
    };
  }
}
