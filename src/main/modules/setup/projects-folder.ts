import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { projectFolder } from "../../core/util";

export interface ProjectRef {
  id: string;
  name: string;
  path: string;
}

export interface FolderScan {
  /** How many projects the workspace config lists (archived ones are not counted). */
  total: number;
  found: string[];
  missing: string[];
}

/** Which of the workspace's projects have a folder under `root` (or at the path this PC was told for them). */
export function scanProjectsRoot(
  projects: ProjectRef[],
  root: string,
  overrides: Record<string, string> = {},
  exists: (path: string) => boolean = existsSync,
): FolderScan {
  const found: string[] = [];
  const missing: string[] = [];
  for (const p of projects) {
    const ok = exists(projectFolder(root, p, overrides));
    (ok ? found : missing).push(p.name);
  }
  return { total: projects.length, found, missing };
}

export interface RootCandidate {
  path: string;
  found: number;
  total: number;
}

/** Where people keep projects, besides the parents of the workspace folder. */
function usualRoots(home: string, exists: (path: string) => boolean): string[] {
  const roots = [
    join(home, "Projects"),
    join(home, "Code"),
    join(home, "dev"),
    join(home, "source", "repos"),
    join(home, "Documents", "GitHub"),
  ];
  if (process.platform === "win32") {
    for (const letter of "CDEFGH") {
      for (const name of ["Projects", "Code", "dev", "repos"]) {
        const path = `${letter}:\\${name}`;
        if (exists(path)) roots.push(path);
      }
    }
  }
  return roots;
}

/**
 * Folders that could be the projects folder, best first: the parents of the workspace folder and the usual roots,
 * each scored by how many of the workspace's projects exist under it.
 */
export function suggestRoots(
  workspaceRoot: string,
  projects: ProjectRef[],
  home: string,
  exists: (path: string) => boolean = existsSync,
): RootCandidate[] {
  const seen = new Set<string>();
  const folders: string[] = [];
  const add = (path: string): void => {
    const key = resolve(path).toLowerCase();
    if (seen.has(key) || !exists(path)) return;
    seen.add(key);
    folders.push(resolve(path));
  };
  // The parents of the workspace folder, up to the drive root, and their siblings named like a projects folder.
  let here = workspaceRoot ? resolve(workspaceRoot) : "";
  while (here && parse(here).root !== here) {
    here = dirname(here);
    add(here);
    for (const name of ["Projects", "Code", "dev"]) {
      add(join(here, name));
      add(join(dirname(here), name));
    }
  }
  for (const root of usualRoots(home, exists)) add(root);
  return folders
    .map((path) => ({
      path,
      found: scanProjectsRoot(projects, path, {}, exists).found.length,
      total: projects.length,
    }))
    .filter((c) => c.found > 0)
    .sort((a, b) => b.found - a.found || a.path.length - b.path.length);
}
