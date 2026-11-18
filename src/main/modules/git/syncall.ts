import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SyncReport, SyncRepoResult } from "../../../shared/models";
import type { Project, Workspace } from "../../../shared/types";
import { run } from "../../core/exec";
import { mapLimit, nowIso } from "../../core/util";
import { parseHubOutput, syncRepo } from "./sync";

export interface SyncAllDeps {
  workspace: () => Workspace | null;
  projectsRoot: () => string;
  workspaceRoot: () => string;
  onReport?: (report: SyncReport) => void | Promise<void>;
  /** Called after each repo finished, so project status can be refreshed. */
  onRepoDone?: (projectId: string) => void;
}

const sameFolder = (a: string, b: string): boolean =>
  resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** Runs the hub tool for a brain hub: it already handles nested repos and their rules. */
export async function syncHub(root: string): Promise<SyncRepoResult[]> {
  const tool = join(root, "tools", "hub.mjs");
  if (!existsSync(tool)) {
    return [
      {
        id: "hub:.",
        name: "Brain hub",
        action: "failed",
        reason: "tools/hub.mjs not found in the workspace repo",
      },
    ];
  }
  const result = await run("node", [tool, "auto"], { cwd: root, timeoutMs: 180_000 });
  if (result.code !== 0 && !result.stdout.trim()) {
    return [
      {
        id: "hub:.",
        name: "Brain hub",
        action: "failed",
        reason: result.stderr.trim().split("\n")[0] ?? "hub tool failed",
      },
    ];
  }
  return parseHubOutput(result.stdout);
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
      const path = resolve(deps.projectsRoot(), project.path);
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
                reason: "not a git repo",
              },
            ];
          }
          const outcome = await syncRepo(path);
          deps.onRepoDone?.(project.id);
          return [{ id: project.id, name: project.name, ...outcome }];
        },
    );
    if (hubRoot) jobs.push(() => syncHub(hubRoot));
    for (const group of await mapLimit(jobs, 4, (job) => job())) results.push(...group);
  }
  const report: SyncReport = { startedAt, finishedAt: nowIso(), repos: results };
  await deps.onReport?.(report);
  return report;
}
