import { z } from "zod";

/** Machine settings: local to one PC, never committed (plan 5.1). */
export const MachineSettings = z.object({
  version: z.literal(1),
  workspaceRoot: z.string().default(""),
  workspaceConfigPath: z.string().default(""),
  projectsRoot: z.string().default(""),
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
  /** How a new agent session opens: as a chat or in a terminal. */
  sessionMode: z.enum(["chat", "terminal"]).default("chat"),
  modules: z.record(z.string(), z.boolean()).default({}),
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

export const Role = z.object({
  provider: z.string(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  instructions: z.string().default(""),
  permissionMode: z.string().optional(),
  readOnly: z.boolean().default(false),
  /** Claude Code permission rules a headless run may use without asking, e.g. "Bash(git commit:*)". */
  allowedCommands: z.array(z.string()).default([]),
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
