import { z } from "zod";
import type { Role } from "./types";

export const AutonomyLevel = z.enum(["ask-first", "act-on-risk", "full-auto"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const DEFAULT_AUTONOMY: AutonomyLevel = "act-on-risk";

export const AUTONOMY_LEVELS: Record<AutonomyLevel, { label: string; description: string }> = {
  "ask-first": {
    label: "Ask first",
    description: "Ask before edits and commands.",
  },
  "act-on-risk": {
    label: "Act, ask on risk",
    description: "Edit and run checks in the project. Ask before risky actions.",
  },
  "full-auto": {
    label: "Full auto",
    description: "Run with full access and skip approval prompts.",
  },
};

const SAFE_COMMANDS = [
  "Bash(git status)",
  "Bash(git diff)",
  "Bash(npm test)",
  "Bash(npm run typecheck)",
  "Bash(npm run lint)",
];

export function roleAutonomy(role: Role | undefined): AutonomyLevel | undefined {
  if (role?.autonomy) return role.autonomy;
  switch (role?.permissionMode) {
    case "bypassPermissions":
      return "full-auto";
    case "acceptEdits":
    case "auto":
      return "act-on-risk";
    case "manual":
    case "plan":
    case "dontAsk":
    case "default":
      return "ask-first";
  }
}

export function effectiveAutonomy(level: AutonomyLevel, confirmed: boolean): AutonomyLevel {
  return level === "full-auto" && !confirmed ? DEFAULT_AUTONOMY : level;
}

export function applyAutonomy(role: Role, level: AutonomyLevel): Role {
  return {
    ...role,
    autonomy: level,
    permissionMode: {
      "ask-first": "manual",
      "act-on-risk": "acceptEdits",
      "full-auto": "bypassPermissions",
    }[level],
    codexSandbox: level === "full-auto" ? "danger-full-access" : "workspace-write",
    readOnly: false,
    allowedCommands: level === "act-on-risk" ? SAFE_COMMANDS : [],
  };
}
