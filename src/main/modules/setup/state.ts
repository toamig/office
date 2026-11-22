import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SetupState, SetupStep, ToolStatus } from "../../../shared/models";

export interface SetupInputs {
  settings: {
    workspaceRoot: string;
    workspaceConfigPath: string;
    projectsRoot: string;
    welcomeDone?: boolean | undefined;
  };
  /** The workspace file's load error, if the file was opened and is broken. */
  workspaceError: string | null;
  /** Null until the first look at the tools has finished. */
  tools: ToolStatus[] | null;
  hooksInstalled: boolean;
  instructionsInstalled?: boolean;
  /** How many projects the workspace lists; the optional Add projects step is met once there is one. */
  projectCount?: number;
  /** Folder and file checks are injected so the rule can be tested without a disk. */
  isDir?: (path: string) => boolean;
  fileExists?: (path: string) => boolean;
}

const dirExists = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** What the tools step still needs: Git, and at least one agent tool installed and logged in. */
export function toolsReason(tools: ToolStatus[] | null): string | null {
  if (!tools) return "Checking your tools...";
  const git = tools.find((t) => t.id === "git");
  if (!git?.installed) return "Git is required. Install it, then check again.";
  const agents = tools.filter((t) => t.id === "claude-code" || t.id === "codex");
  if (agents.some((t) => t.installed && t.loggedIn === true)) return null;
  if (agents.some((t) => t.installed))
    return "Log in to Claude Code or Codex to continue. Log in, then check again.";
  return "Install Claude Code or Codex, and log in, to continue.";
}

/**
 * The welcome flow's state (spec 4.8). The workspace and the projects folder are checked on the disk every time,
 * so a folder that goes missing sends the app back to its step; the tools only gate the first run, because a
 * login that lapses later is shown in Setup and on Home, and must not lock the owner out of everything.
 */
export function computeSetupState(input: SetupInputs): SetupState {
  const isDir = input.isDir ?? dirExists;
  const fileExists = input.fileExists ?? existsSync;
  const { workspaceRoot, workspaceConfigPath, projectsRoot } = input.settings;
  const welcomeDone = input.settings.welcomeDone === true;

  let workspaceReason: string | null = null;
  if (!workspaceRoot) workspaceReason = "Choose or clone your workspace folder.";
  else if (!isDir(workspaceRoot))
    workspaceReason = `The workspace folder ${workspaceRoot} is gone. Choose it again.`;
  else if (!workspaceConfigPath || !fileExists(join(workspaceRoot, workspaceConfigPath)))
    workspaceReason = `${workspaceConfigPath || "The config file"} is missing from the workspace folder.`;
  else if (input.workspaceError) workspaceReason = input.workspaceError;

  let projectsReason: string | null = null;
  if (!projectsRoot) projectsReason = "Choose the folder your projects live in.";
  else if (!isDir(projectsRoot))
    projectsReason = `The projects folder ${projectsRoot} is gone. Choose it again.`;

  const toolsProblem = toolsReason(input.tools);
  const steps: SetupStep[] = [
    {
      id: "workspace",
      label: "Workspace",
      required: true,
      met: !workspaceReason,
      reason: workspaceReason,
    },
    {
      id: "projects",
      label: "Projects folder",
      required: true,
      met: !projectsReason,
      reason: projectsReason,
    },
    { id: "tools", label: "Tools", required: true, met: !toolsProblem, reason: toolsProblem },
    {
      id: "add",
      label: "Your projects",
      required: false,
      met: (input.projectCount ?? 0) > 0,
      reason: null,
    },
    ...(input.instructionsInstalled === undefined ? [] : [{
      id: "instructions" as const, label: "Agent instructions", required: false,
      met: input.instructionsInstalled, reason: null,
    }]),
    {
      id: "notifications",
      label: "Agent notifications",
      required: false,
      met: input.hooksInstalled,
      reason: null,
    },
  ];
  const brokenBasics = !steps[0]!.met || !steps[1]!.met;
  const welcome = !welcomeDone || brokenBasics;
  const firstUnmet = steps.find((s) => s.required && !s.met);
  return { welcome, steps, current: firstUnmet?.id ?? "tools" };
}
