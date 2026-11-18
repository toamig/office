import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
