import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sh, tmp } from "../repos/make";

const template = resolve(__dirname, "template");

export interface World {
  root: string;
  /** The fixture brain hub (workspaceRoot). */
  hub: string;
  /** Folder that holds the code repos of the fixture projects. */
  projectsRoot: string;
  workspaceConfigPath: string;
  /** Bare remote of the hub repo ("." ) and of each nested repo, by folder. */
  remotes: Record<string, string>;
  /** Code repo folders by project id, and their bare remotes. */
  code: Record<string, { work: string; bare: string }>;
}

const NESTED = ["Common", "Alpha", "Beta", "Office"];

function initWithRemote(dir: string, bare: string, message: string): void {
  mkdirSync(bare, { recursive: true });
  sh(bare, "init", "-q", "--bare", "-b", "main");
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "remote", "add", "origin", bare);
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", message);
  sh(dir, "push", "-q", "-u", "origin", "main");
}

/**
 * Builds a throwaway world: a brain hub with nested repos (each with a bare remote), and two
 * code repos for the fixture projects. Everything lives in a fresh temp folder.
 */
export function makeWorld(): World {
  const root = tmp("office-world-");
  const hub = join(root, "Brain");
  cpSync(template, hub, { recursive: true });
  const remotes: Record<string, string> = {};
  for (const folder of NESTED) {
    remotes[folder] = join(root, "remotes", `${folder}.git`);
    initWithRemote(join(hub, folder), remotes[folder], `${folder}: initial`);
  }
  // The hub ignores its nested repos, like the real brain does.
  writeFileSync(join(hub, ".gitignore"), NESTED.map((f) => `${f}/\n`).join(""));
  remotes["."] = join(root, "remotes", "hub.git");
  initWithRemote(hub, remotes["."], "hub: initial");

  const projectsRoot = join(root, "Projects");
  const code: World["code"] = {};
  for (const id of ["alpha", "beta"]) {
    const dir = join(projectsRoot, id === "alpha" ? "Alpha" : "Beta");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), `# ${id}\n`);
    const bare = join(root, "remotes", `code-${id}.git`);
    initWithRemote(dir, bare, `${id}: initial`);
    code[id] = { work: dir, bare };
  }
  return { root, hub, projectsRoot, workspaceConfigPath: "Office/workspace.json", remotes, code };
}

/** Rewrites the fixture workspace config in place (no commit). */
export function patchWorkspace(world: World, edit: (json: Record<string, unknown>) => void): void {
  const path = join(world.hub, world.workspaceConfigPath);
  const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  edit(json);
  writeFileSync(path, JSON.stringify(json, null, 2));
}

/** The folder names that appear in a world, in every path string it holds. */
function remap(world: World, from: string, to: string): World {
  const swap = (value: string): string => (value.startsWith(from) ? to + value.slice(from.length) : value);
  return {
    root: swap(world.root),
    hub: swap(world.hub),
    projectsRoot: swap(world.projectsRoot),
    workspaceConfigPath: world.workspaceConfigPath,
    remotes: Object.fromEntries(Object.entries(world.remotes).map(([k, v]) => [k, swap(v)])),
    code: Object.fromEntries(
      Object.entries(world.code).map(([k, v]) => [k, { work: swap(v.work), bare: swap(v.bare) }]),
    ),
  };
}

/** Every `.git/config` file under a folder (the repos of a world; the nested ones too). */
function gitConfigs(dir: string): string[] {
  const found: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git") {
        if (existsSync(join(path, "config"))) found.push(join(path, "config"));
        continue;
      }
      walk(path);
    }
  };
  walk(dir);
  return found;
}

let worldTemplate: World | null = null;

/**
 * A fresh world, as makeWorld() builds it, but made by copying one that this process built before: building a world
 * runs about sixty git commands (two seconds), copying it takes a fraction of that. The copy's repos point at
 * the copy's own remotes, so no two worlds ever share a repo.
 */
export function freshWorld(): World {
  worldTemplate ??= makeWorld();
  const root = tmp("office-world-");
  cpSync(worldTemplate.root, root, { recursive: true, preserveTimestamps: true });
  const from = worldTemplate.root;
  const spellings = (path: string): string[] => [
    path,
    path.replaceAll("\\", "/"),
    path.replaceAll("\\", "\\\\"),
  ];
  const pairs = spellings(from).map((old, i) => [old, spellings(root)[i] as string] as const);
  for (const config of gitConfigs(root)) {
    let text = readFileSync(config, "utf8");
    for (const [old, now] of pairs) text = text.split(old).join(now);
    writeFileSync(config, text);
  }
  return remap(worldTemplate, from, root);
}
