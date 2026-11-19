/**
 * Permission profiles (plan Workbench 1.3): what an agent may do, named once and given to roles. A profile maps to
 * the exact flags of each provider here, in one place, so a unit test can pin every one of them.
 */
import type { PermissionProfile, Role, Workspace } from "./types";

export type ClaudeMode = NonNullable<PermissionProfile["claudeMode"]>;
export type CodexSandbox = PermissionProfile["codexSandbox"];

/** Claude Code's permission modes, each with its explanation. Bypass is behind a confirmation and never a default. */
export const CLAUDE_MODES: Array<{
  id: ClaudeMode;
  label: string;
  description: string;
  unsafe?: boolean;
}> = [
  {
    id: "default",
    label: "Ask first",
    description: "Asks before it edits files or runs commands.",
  },
  {
    id: "acceptEdits",
    label: "Accept edits",
    description: "Edits files without asking; still asks for commands outside the allowed list.",
  },
  {
    id: "plan",
    label: "Plan only",
    description: "Reads and plans, and changes nothing.",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Decides by itself, within the allowed commands.",
  },
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    description: "Never asks. It can change or delete anything the account can.",
    unsafe: true,
  },
];

/** Codex's sandboxes. Full access is behind the same confirmation. */
export const CODEX_SANDBOXES: Array<{
  id: CodexSandbox;
  label: string;
  description: string;
  unsafe?: boolean;
}> = [
  { id: "read-only", label: "Read only", description: "Can read the project and nothing else." },
  {
    id: "workspace-write",
    label: "Can edit the project folder",
    description: "Can change files in the project folder, and nowhere else.",
  },
  {
    id: "danger-full-access",
    label: "Full access",
    description: "Can change anything the account can, with no sandbox.",
    unsafe: true,
  },
];

/** Rules to pick from when editing the allowed and denied commands. */
export const COMMAND_EXAMPLES: Array<{ label: string; rule: string; description: string }> = [
  { label: "Run tests", rule: "Bash(npm test:*)", description: "Runs the project's tests." },
  { label: "Run scripts", rule: "Bash(npm run:*)", description: "Runs any npm script." },
  { label: "Read git history", rule: "Bash(git log:*)", description: "Reads the commit history." },
  { label: "See changes", rule: "Bash(git diff:*)", description: "Shows what changed." },
  {
    label: "See status",
    rule: "Bash(git status:*)",
    description: "Shows the state of the working tree.",
  },
  { label: "Stage files", rule: "Bash(git add:*)", description: "Stages files for a commit." },
  { label: "Commit", rule: "Bash(git commit:*)", description: "Makes a commit." },
  { label: "Push", rule: "Bash(git push:*)", description: "Sends commits to the remote." },
  { label: "Delete files", rule: "Bash(rm:*)", description: "Removes files." },
];

/** The commands a builder may run without asking (plan 9.5). */
export const BUILDER_COMMANDS = [
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(npm run:*)",
  "Bash(npm test:*)",
];

/** What a reviewer may run: read the history and run the checks. */
export const REVIEWER_COMMANDS = [
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(npm run lint:*)",
  "Bash(npm test:*)",
];

export type NamedProfile = PermissionProfile & { id: string; builtIn: boolean };

const profile = (
  p: Partial<PermissionProfile> & Pick<PermissionProfile, "name">,
): PermissionProfile => ({
  description: "",
  codexSandbox: "workspace-write",
  allowedCommands: [],
  deniedCommands: [],
  ...p,
});

/** The profiles that ship with Office: they can be duplicated but not edited or removed. */
export const BUILT_IN_PROFILES: Record<string, PermissionProfile> = {
  "read-only": profile({
    name: "Read only",
    description: "Reads the project and nothing else. It cannot edit files or run commands.",
    claudeMode: "plan",
    codexSandbox: "read-only",
  }),
  "ask-first": profile({
    name: "Ask first",
    description: "Asks before it edits files or runs commands.",
    claudeMode: "default",
    codexSandbox: "workspace-write",
  }),
  "plan-only": profile({
    name: "Plan only",
    description: "Reads and plans, and changes nothing.",
    claudeMode: "plan",
    codexSandbox: "read-only",
  }),
  builder: profile({
    name: "Builder",
    description: "Edits files without asking and runs the checks and git commands of a builder.",
    claudeMode: "acceptEdits",
    codexSandbox: "workspace-write",
    allowedCommands: BUILDER_COMMANDS,
  }),
  reviewer: profile({
    name: "Reviewer",
    description: "Reads the project, runs the tests and lint, and cannot edit.",
    claudeMode: "default",
    codexSandbox: "read-only",
    allowedCommands: REVIEWER_COMMANDS,
  }),
};

/** Every profile: the built-in ones first, then the workspace's own. */
export function allProfiles(custom: Record<string, PermissionProfile> | undefined): NamedProfile[] {
  return [
    ...Object.entries(BUILT_IN_PROFILES).map(([id, p]) => ({ ...p, id, builtIn: true })),
    ...Object.entries(custom ?? {})
      .filter(([id]) => !(id in BUILT_IN_PROFILES))
      .map(([id, p]) => ({ ...p, id, builtIn: false })),
  ];
}

export function profileById(
  id: string | undefined,
  custom: Record<string, PermissionProfile> | undefined,
): PermissionProfile | undefined {
  if (!id) return undefined;
  return BUILT_IN_PROFILES[id] ?? custom?.[id];
}

/**
 * The Claude Code mode a profile really runs with. Bypass runs only after the owner confirmed it on the profile;
 * without that it is Accept edits, so a hand-edited config can never turn it on by accident.
 */
export function effectiveClaudeMode(p: PermissionProfile): ClaudeMode {
  const mode = p.claudeMode ?? "default";
  return mode === "bypassPermissions" && p.confirmedUnsafe !== true ? "acceptEdits" : mode;
}

/** The Codex sandbox a profile really runs with; full access needs the same confirmation. */
export function effectiveSandbox(p: PermissionProfile): CodexSandbox {
  return p.codexSandbox === "danger-full-access" && p.confirmedUnsafe !== true
    ? "workspace-write"
    : p.codexSandbox;
}

/** `claude --permission-mode <mode>` for a profile, or nothing for the default. */
export function claudeModeFlags(p: PermissionProfile): string[] {
  const mode = effectiveClaudeMode(p);
  return mode === "default" ? [] : ["--permission-mode", mode];
}

/** `codex exec -s <sandbox>` for a profile. */
export function codexSandboxArgs(p: PermissionProfile): string[] {
  return ["-s", effectiveSandbox(p)];
}

/** The reasons a profile cannot be saved, in words; an empty list means it can. */
export function profileProblems(p: PermissionProfile): string[] {
  const problems: string[] = [];
  if (!p.name.trim()) problems.push("A profile needs a name.");
  if (p.claudeMode === "bypassPermissions" && p.confirmedUnsafe !== true)
    problems.push('Bypass permissions needs the confirmation: tick "I understand".');
  if (p.codexSandbox === "danger-full-access" && p.confirmedUnsafe !== true)
    problems.push('Full access needs the confirmation: tick "I understand".');
  return problems;
}

/** A role as the code that starts agents reads it: the fields a profile decides are filled in. */
export function resolveRole(
  role: Role,
  custom: Record<string, PermissionProfile> | undefined,
): Role {
  const p = profileById(role.permissionProfile, custom);
  if (!p) return role;
  const mode = effectiveClaudeMode(p);
  const sandbox = effectiveSandbox(p);
  const { permissionMode: _drop, ...rest } = role;
  return {
    ...rest,
    ...(mode === "default" ? {} : { permissionMode: mode }),
    readOnly: sandbox === "read-only",
    allowedCommands: p.allowedCommands,
    deniedCommands: p.deniedCommands,
    codexSandbox: sandbox,
  };
}

const CLAUDE_MODE_IDS = new Set<string>(CLAUDE_MODES.map((m) => m.id));

/**
 * Turns the old per-role fields (permission mode, read only, allowed commands) into a custom profile named after
 * the role, so every old role keeps exactly what it did. Roles that already name a profile are left alone.
 */
export function migrateLegacyRoles(
  roles: Record<string, Role>,
  custom: Record<string, PermissionProfile> | undefined,
): {
  roles: Record<string, Role>;
  profiles: Record<string, PermissionProfile>;
  migrated: string[];
} {
  const profiles = { ...(custom ?? {}) };
  const out: Record<string, Role> = {};
  const migrated: string[] = [];
  for (const [id, role] of Object.entries(roles)) {
    if (role.permissionProfile) {
      out[id] = role;
      continue;
    }
    const mode =
      role.permissionMode && CLAUDE_MODE_IDS.has(role.permissionMode)
        ? role.permissionMode
        : undefined;
    // The id never clashes with a built-in profile or another of the workspace's own.
    const name = id in profiles || id in BUILT_IN_PROFILES ? `${id}-role` : id;
    profiles[name] = {
      name: id,
      description: `What the ${id} role did before profiles existed.`,
      ...(mode && mode !== "bypassPermissions" ? { claudeMode: mode as ClaudeMode } : {}),
      codexSandbox: role.readOnly ? "read-only" : "workspace-write",
      allowedCommands: role.allowedCommands,
      deniedCommands: [],
    };
    const { permissionMode: _m, readOnly: _r, allowedCommands: _a, ...rest } = role;
    out[id] = {
      ...rest,
      readOnly: false,
      allowedCommands: [],
      deniedCommands: [],
      permissionProfile: name,
    };
    migrated.push(id);
  }
  return { roles: out, profiles, migrated };
}

/** The workspace as the app uses it: old roles migrated to profiles, and every role's profile resolved. */
export function resolveWorkspace(ws: Workspace): Workspace {
  const { roles, profiles } = migrateLegacyRoles(ws.roles, ws.permissionProfiles);
  const resolved: Record<string, Role> = {};
  for (const [id, role] of Object.entries(roles)) resolved[id] = resolveRole(role, profiles);
  return { ...ws, roles: resolved, permissionProfiles: profiles };
}

/** The role as it is written to the config: the profile's id, and none of the fields the profile decides. */
export function roleForFile(role: Role): Record<string, unknown> {
  const {
    permissionMode: _m,
    readOnly: _r,
    allowedCommands: _a,
    deniedCommands: _d,
    codexSandbox: _c,
    ...rest
  } = role;
  return rest;
}
