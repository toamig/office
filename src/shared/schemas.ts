import { z } from "zod";

/** Machine settings: local to one PC, never committed (plan 5.1). */
export const MachineSettings = z.object({
  version: z.literal(1),
  workspaceRoot: z.string().default(""),
  workspaceConfigPath: z.string().default(""),
  projectsRoot: z.string().default(""),
  /** Where a project's folder is on this PC when it is not under the projects folder: project id to absolute path. */
  projectPaths: z.record(z.string(), z.string()).default({}),
  editorCommand: z.string().default("code"),
  /** Where a finished Art request is filed (one folder per project inside it). Empty: nowhere. */
  artVaultRoot: z.string().default(""),
  relay: z.object({ port: z.number().int(), token: z.string() }),
  quietHours: z.object({ from: z.string(), to: z.string() }).optional(),
  window: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      maximized: z.boolean().optional(),
    })
    .optional(),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  /** The owner's accent colour; empty means the palette's own. */
  accent: z.string().default(""),
  density: z.enum(["compact", "comfortable"]).default("comfortable"),
  /** Interface zoom in percent (80 to 150), set with Ctrl+= and Ctrl+-. */
  zoom: z.number().int().min(80).max(150).default(100),
  sidebarCollapsed: z.boolean().default(false),
  /** The sidebar's width in pixels when it is open (200 to 320). */
  sidebarWidth: z.number().int().min(200).max(320).default(240),
  /** The inspector's width in pixels when it is open (280 to 480). */
  inspectorWidth: z.number().int().min(280).max(480).default(360),
  /** The views whose inspector the owner hid. */
  inspectorHidden: z.record(z.string(), z.boolean()).default({}),
  /** Where the owner put each split-pane divider, by pane id, in pixels of the first pane. */
  panes: z.record(z.string(), z.number()).default({}),
  /** How a new agent session opens: as a chat or in a terminal. */
  sessionMode: z.enum(["chat", "terminal"]).default("chat"),
  modules: z.record(z.string(), z.boolean()).default({}),
  /**
   * Whether the welcome flow was finished. Absent means the setting was never recorded: a machine that was set
   * up before the flow existed is marked done at start; a first run records false when the flow begins.
   */
  welcomeDone: z.boolean().optional(),
});

export const Project = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  path: z.string(),
  vault: z.string().optional(),
  group: z.string().optional(),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  roles: z.record(z.string(), z.string()).optional(),
});

/** What agents may do: Claude Code's mode, Codex's sandbox, and rules for commands (plan Workbench 1.3). */
export const PermissionProfile = z.object({
  name: z.string(),
  /** One plain sentence saying what an agent using it may do. */
  description: z.string().default(""),
  claudeMode: z.enum(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]).optional(),
  codexSandbox: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .default("workspace-write"),
  /** Claude Code rules an agent may use without asking, e.g. "Bash(git commit:*)". */
  allowedCommands: z.array(z.string()).default([]),
  /** Rules an agent may never use. */
  deniedCommands: z.array(z.string()).default([]),
  /** The owner confirmed Bypass permissions or Full access for this profile. */
  confirmedUnsafe: z.boolean().optional(),
});

export const Role = z.object({
  provider: z.string(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  instructions: z.string().default(""),
  /** One line on what the role is for. */
  purpose: z.string().optional(),
  /** The id of a permission profile (built in, or one of the workspace's own). */
  permissionProfile: z.string().optional(),
  /** The fields below are what roles had before profiles; a role that has none of its own gets a profile at load. */
  permissionMode: z.string().optional(),
  readOnly: z.boolean().default(false),
  /** Claude Code permission rules a headless run may use without asking, e.g. "Bash(git commit:*)". */
  allowedCommands: z.array(z.string()).default([]),
  /** Filled in from the profile: rules that are never allowed, and the Codex sandbox. */
  deniedCommands: z.array(z.string()).optional(),
  codexSandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
});

export const Stage = z.object({
  id: z.string(),
  role: z.string(),
  gate: z.boolean().default(false),
  worktree: z.boolean().default(false),
  prompt: z.string(),
});

export const Pipeline = z.object({ name: z.string(), stages: z.array(Stage) });

export const Automation = z.object({
  id: z.string(),
  cron: z.string(),
  project: z.string(),
  role: z.string(),
  prompt: z.string(),
  enabled: z.boolean().default(true),
});

/** Workspace config: committed in the workspace repo, travels between PCs (plan 5.2). */
export const Workspace = z.object({
  version: z.literal(1),
  vault: z.object({
    kind: z.enum(["brain-hub", "folder", "none"]),
    openItemsFile: z.string().default("OpenItems.md"),
    waitingHeading: z.string().default("Waiting on you"),
  }),
  projects: z.array(Project),
  roles: z.record(z.string(), Role),
  permissionProfiles: z.record(z.string(), PermissionProfile).optional(),
  pipelines: z.record(z.string(), Pipeline),
  notifications: z.object({
    urgent: z.array(z.string()),
    mutedProjects: z.array(z.string()).default([]),
    ntfyTopicUrl: z.url().optional(),
  }),
  automations: z.array(Automation).default([]),
  archiveAfterDays: z.number().int().default(7),
  briefTime: z.string().default("08:00"),
});
