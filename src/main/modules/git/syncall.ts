import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SyncReport, SyncRepoResult } from "../../../shared/models";
import type { Project, Workspace } from "../../../shared/types";
import { mapLimit, nowIso, projectFolder } from "../../core/util";
import { parseHubOutput, syncRepo } from "./sync";
import { runRuleTool } from "../vault/rule-pack";

export interface SyncAllDeps {
  workspace: () => Workspace | null;
  projectsRoot: () => string;
  projectPaths?: () => Record<string, string>;
  workspaceRoot: () => string;
  onReport?: (report: SyncReport) => void | Promise<void>;
  /** Called after each repo finished, so project status can be refreshed. */
  onRepoDone?: (projectId: string) => void;
}

const sameFolder = (a: string, b: string): boolean =>
  resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * Runs the hub tool for a brain hub: it already handles nested repos and their rules. When it exits with
 * an error, or times out, a failed "hub:." row is always added, whatever else it printed.
 */
export async function syncHub(root: string, timeoutMs = 180_000): Promise<SyncRepoResult[]> {
  const tool = join(root, "tools", "hub.mjs");
  const sync = runRuleTool(root, "sync", timeoutMs, existsSync(tool) ? ["node", tool, "auto"] : undefined);
  if (!sync) {
    return [
      {
        id: "hub:.",
        name: "Brain hub",
        action: "failed",
        reason: "tools/hub.mjs not found in the workspace repo",
      },
    ];
  }
  const result = await sync;
  const rows = parseHubOutput(result.stdout);
  if (result.code === 0 && !result.timedOut)
    return rows.length ? rows : [{ id: "hub:.", name: "Brain hub", action: "up-to-date" }];
  const reason = result.timedOut
    ? `the hub tool did not finish in ${Math.round(timeoutMs / 1000)} seconds`
    : result.stderr.trim().split(/\r?\n/)[0] ||
      result.stdout.trim().split(/\r?\n/).at(-1) ||
      `the hub tool exited with code ${result.code}`;
  const own = rows.find((row) => row.id === "hub:.");
  if (own && (own.action === "failed" || own.action === "conflict")) return rows;
  return [
    ...rows.filter((row) => row.id !== "hub:."),
    { id: "hub:.", name: "Brain hub", action: "failed", reason },
  ];
}

async function syncFolder(root: string): Promise<SyncRepoResult[]> {
  if (!root || !existsSync(join(root, ".git"))) return [];
  const task = runRuleTool(root, "sync", 180_000);
  const result = task ? await task : null;
  return [{ id: "hub:.", name: "Brain", ...(result
    ? { action: result.code === 0 ? "up-to-date" : "failed", reason: result.stderr.trim() || undefined }
    : await syncRepo(root)) }];
}

/** Sync all: every project repo four at a time, plus the brain hub through its own tool. */
export async function syncAll(deps: SyncAllDeps): Promise<SyncReport> {
  const startedAt = nowIso();
  const workspace = deps.workspace();
  const results: SyncRepoResult[] = [];
  if (workspace) {
    const hubRoot = workspace.vault.kind === "brain-hub" ? deps.workspaceRoot() : null;
    const projects: Array<{ project: Project; path: string }> = [];
    for (const project of workspace.projects) {
      if (project.archived) continue;
      const path = projectFolder(deps.projectsRoot(), project, deps.projectPaths?.());
      if (hubRoot && sameFolder(path, hubRoot)) continue; // covered by the hub tool
      projects.push({ project, path });
    }
    const jobs: Array<() => Promise<SyncRepoResult[]>> = projects.map(
      ({ project, path }) =>
        async () => {
          if (!existsSync(join(path, ".git"))) {
            return [
              {
                id: project.id,
                name: project.name,
                action: "skipped" as const,
                reason: existsSync(path) ? "not a git repo" : `folder missing (${path})`,
              },
            ];
          }
          const outcome = await syncRepo(path);
          deps.onRepoDone?.(project.id);
          return [{ id: project.id, name: project.name, ...outcome }];
        },
    );
    if (hubRoot) jobs.push(() => syncHub(hubRoot));
    else if (workspace.vault.kind === "folder") jobs.push(() => syncFolder(deps.workspaceRoot()));
    for (const group of await mapLimit(jobs, 4, (job) => job())) results.push(...group);
  }
  const report: SyncReport = { startedAt, finishedAt: nowIso(), repos: results };
  await deps.onReport?.(report);
  return report;
}

/** Sync one project's repo (the project page's Sync button). */
export async function syncProject(deps: SyncAllDeps, projectId: string): Promise<SyncReport> {
  const startedAt = nowIso();
  const workspace = deps.workspace();
  const project = workspace?.projects.find((p) => p.id === projectId);
  const results: SyncRepoResult[] = [];
  if (project && workspace) {
    const path = projectFolder(deps.projectsRoot(), project, deps.projectPaths?.());
    const isHub = workspace.vault.kind === "brain-hub" && sameFolder(path, deps.workspaceRoot());
    if (isHub) results.push(...(await syncHub(deps.workspaceRoot())));
    else if (!existsSync(join(path, ".git"))) {
      results.push({
        id: project.id,
        name: project.name,
        action: "skipped",
        reason: existsSync(path) ? "not a git repo" : `folder missing (${path})`,
      });
    } else {
      results.push({ id: project.id, name: project.name, ...(await syncRepo(path)) });
      deps.onRepoDone?.(project.id);
    }
  }
  const report: SyncReport = { startedAt, finishedAt: nowIso(), repos: results };
  await deps.onReport?.(report);
  return report;
}
