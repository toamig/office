import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SearchItem } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import { mapLimit } from "../../core/util";
import { listBranches } from "../git/branches";
import type { ProjectService } from "../git/service";
import { listWorktrees } from "../git/worktrees";
import { noteAndProjectItems } from "../notes/notes";
import type { SessionService } from "../sessions/service";

const CACHE_MS = 30_000;
let cache: { at: number; key: string; items: SearchItem[] } | null = null;

/** Forgets the cached branch and worktree names (tests, and after changes the owner just made). */
export function clearSearchCache(): void {
  cache = null;
}

/** Everything the quick switcher can jump to: projects, notes, branches, worktrees and sessions. */
export async function buildSearchItems(deps: {
  workspace: Workspace | null;
  workspaceRoot: string;
  projects: ProjectService;
  sessions: SessionService;
}): Promise<SearchItem[]> {
  const base = noteAndProjectItems(deps.workspace, deps.workspaceRoot);
  const sessions: SearchItem[] = deps.sessions.list().map((s) => ({
    kind: "session",
    label: s.title ?? s.provider,
    detail: s.status,
    link: {
      view: "agents",
      params: { session: s.id, ...(s.projectId ? { project: s.projectId } : {}) },
    },
  }));

  const key = (deps.workspace?.projects ?? []).map((p) => p.id).join(",");
  if (!cache || Date.now() - cache.at > CACHE_MS || cache.key !== key) {
    const repos = (deps.workspace?.projects ?? []).filter(
      (p) => !p.archived && existsSync(join(deps.projects.absPath(p), ".git")),
    );
    const groups = await mapLimit(repos, 4, async (p): Promise<SearchItem[]> => {
      const path = deps.projects.absPath(p);
      const items: SearchItem[] = [];
      try {
        for (const b of (await listBranches(path)).local) {
          items.push({
            kind: "branch",
            label: `${p.name}: ${b.name}`,
            link: { view: "git", params: { project: p.id, tab: "branches" } },
          });
        }
        for (const w of await listWorktrees(path)) {
          if (w.kind === "main") continue;
          items.push({
            kind: "worktree",
            label: `${p.name}: ${w.branch ?? w.path}`,
            detail: w.kind,
            link: { view: "git", params: { project: p.id, tab: "worktrees" } },
          });
        }
      } catch {
        /* a repo that cannot be read just has no entries */
      }
      return items;
    });
    cache = { at: Date.now(), key, items: groups.flat() };
  }
  return [...base, ...cache.items, ...sessions];
}
