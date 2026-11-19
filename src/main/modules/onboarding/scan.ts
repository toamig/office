import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { git } from "../git/run";

export interface Candidate {
  /** Absolute folder of the code repo. */
  path: string;
  /** The suggested project name. */
  name: string;
  remote: string | null;
  /** ISO date of the last commit, or null for a repo with none. */
  lastCommit: string | null;
  /** Guessed from the parent folder; "Other" for a repo straight under the projects folder. */
  group: string;
  /** The notes folder (relative to the brain) that has the same name, when one exists. */
  notes: string | null;
}

const SKIP = new Set([
  "node_modules",
  "out",
  "dist",
  "build",
  "release",
  "target",
  "venv",
  ".venv",
]);

const norm = (path: string): string => resolve(path).replaceAll("\\", "/").toLowerCase();
const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A name for the project from what is in its folder: package.json, a .uproject, Cargo.toml, pyproject.toml, else the folder. */
export function suggestName(dir: string): string {
  try {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const name = (JSON.parse(readFileSync(pkg, "utf8")) as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) return name.replace(/^@[^/]+\//, "");
    }
    const uproject = readdirSync(dir).find((f) => f.toLowerCase().endsWith(".uproject"));
    if (uproject) return uproject.slice(0, -".uproject".length);
    for (const file of ["Cargo.toml", "pyproject.toml"]) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      const found = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(path, "utf8"));
      if (found?.[1]) return found[1];
    }
  } catch {
    /* an unreadable file is not a name */
  }
  return basename(dir);
}

/** Folders with a `.git` directory, up to two levels under the root. A `.git` file (a worktree) is skipped. */
export function findRepos(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") || SKIP.has(name)) continue;
      const path = join(dir, name);
      if (!isDir(path)) continue;
      const dotGit = join(path, ".git");
      if (existsSync(dotGit)) {
        if (isDir(dotGit)) out.push(path);
        continue;
      }
      if (depth < 2) visit(path, depth + 1);
    }
  };
  visit(root, 1);
  return out;
}

/** The notes folders of the brain that could belong to a project: those with an Overview.md, relative to the brain. */
export function noteFolders(
  workspaceRoot: string,
  kind: "folder" | "brain-hub" | "none",
): string[] {
  if (!workspaceRoot || kind === "none") return [];
  const base = kind === "folder" ? join(workspaceRoot, "Projects") : workspaceRoot;
  if (!isDir(base)) return [];
  return readdirSync(base)
    .filter((n) => !n.startsWith(".") && existsSync(join(base, n, "Overview.md")))
    .map((n) => relative(workspaceRoot, join(base, n)).replaceAll("\\", "/"));
}

/**
 * The code repos under the projects folder that are not in the workspace yet, each with a suggested name, its remote,
 * its last commit, a group and the notes that already exist for it.
 */
export async function scanProjects(
  projectsRoot: string,
  known: string[],
  notes: string[],
): Promise<Candidate[]> {
  const have = new Set(known.map(norm));
  const out: Candidate[] = [];
  for (const path of findRepos(projectsRoot)) {
    if (have.has(norm(path))) continue;
    const name = suggestName(path);
    const remote = await git(path, ["config", "--get", "remote.origin.url"]);
    const last = await git(path, ["log", "-1", "--format=%cI"]);
    const parent = basename(resolve(path, ".."));
    const underRoot = norm(resolve(path, "..")) === norm(projectsRoot);
    const match = notes.find(
      (n) => slug(basename(n)) === slug(name) || slug(basename(n)) === slug(basename(path)),
    );
    out.push({
      path,
      name,
      remote: remote.code === 0 ? remote.stdout.trim() || null : null,
      lastCommit: last.code === 0 ? last.stdout.trim() || null : null,
      group: underRoot ? "Other" : parent,
      notes: match ?? null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
