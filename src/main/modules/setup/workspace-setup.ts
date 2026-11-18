import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import example from "../../../../examples/workspace.example.json";
import type { WorkspaceInspection } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import { run } from "../../core/exec";
import { IpcFailure } from "../../core/ipc";
import { writeTextFile } from "../../core/settings";
import { loadWorkspaceFile } from "../../core/workspace";

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** What is in a folder the owner picked as the workspace repo. */
export function inspectWorkspaceFolder(root: string): WorkspaceInspection {
  if (!isDir(root)) return { exists: false, isGitRepo: false, hasBrainHub: false, configs: [] };
  const configs: string[] = [];
  if (existsSync(join(root, "workspace.json"))) configs.push("workspace.json");
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      existsSync(join(root, entry.name, "workspace.json"))
    ) {
      configs.push(`${entry.name}/workspace.json`);
    }
  }
  return {
    exists: true,
    isGitRepo: existsSync(join(root, ".git")),
    hasBrainHub: existsSync(join(root, "brain.repos.json")),
    configs,
  };
}

/** A generic starter config (the example, without its sample projects). */
export function defaultWorkspace(hubVault: boolean): Workspace {
  return {
    ...(example as unknown as Workspace),
    vault: {
      kind: hubVault ? "brain-hub" : "folder",
      openItemsFile: "OpenItems.md",
      waitingHeading: "Waiting on you",
    },
    projects: [],
  };
}

/** Clones the workspace repo; for a brain hub it then clones the nested repos with the hub's own tool. */
export async function cloneWorkspaceRepo(
  url: string,
  dest: string,
): Promise<{ path: string; hubCloned: boolean }> {
  if (!url.trim() || url.trim().startsWith("-"))
    throw new IpcFailure("bad-url", "Enter the git URL of your workspace repo");
  const target = resolve(dest);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new IpcFailure(
      "dest-not-empty",
      `${target} already has files in it. Pick an empty folder.`,
    );
  }
  const clone = await run("git", ["clone", "--", url.trim(), target], { timeoutMs: 600_000 });
  if (clone.code !== 0) {
    throw new IpcFailure(
      "clone-failed",
      `git clone failed: ${clone.stderr.trim().split("\n").pop() ?? ""}`,
    );
  }
  const tool = join(target, "tools", "hub.mjs");
  if (existsSync(join(target, "brain.repos.json")) && existsSync(tool)) {
    const hub = await run("node", [tool, "clone"], { cwd: target, timeoutMs: 900_000 });
    if (hub.code !== 0) {
      throw new IpcFailure(
        "hub-clone-failed",
        `The hub cloned, but its nested repos did not: ${hub.stderr.trim().split("\n")[0] ?? ""}`,
      );
    }
    return { path: target, hubCloned: true };
  }
  return { path: target, hubCloned: false };
}

export interface ApplyInput {
  workspaceRoot: string;
  workspaceConfigPath: string;
  projectsRoot: string;
  createIfMissing: boolean;
}

/** Validates the wizard's choices and creates a starter config when asked. Throws IpcFailure on problems. */
export function prepareWorkspace(input: ApplyInput): void {
  const root = resolve(input.workspaceRoot);
  if (!isDir(root)) throw new IpcFailure("no-workspace", `${root} is not a folder`);
  if (!isDir(resolve(input.projectsRoot))) {
    throw new IpcFailure("no-projects-root", `${resolve(input.projectsRoot)} is not a folder`);
  }
  if (!input.workspaceConfigPath.trim() || input.workspaceConfigPath.includes("..")) {
    throw new IpcFailure(
      "bad-config-path",
      "Enter a path inside the workspace folder, like Office/workspace.json",
    );
  }
  const file = join(root, input.workspaceConfigPath);
  if (!existsSync(file)) {
    if (!input.createIfMissing) {
      throw new IpcFailure(
        "no-config",
        `${input.workspaceConfigPath} does not exist yet. Tick "create it" to start from the example.`,
      );
    }
    const hub = existsSync(join(root, "brain.repos.json"));
    writeTextFile(file, `${JSON.stringify(defaultWorkspace(hub), null, 2)}\n`);
  }
  const loaded = loadWorkspaceFile(file);
  if (!loaded.ok) throw new IpcFailure("invalid-config", loaded.error);
}
