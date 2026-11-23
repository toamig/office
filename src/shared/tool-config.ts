import { z } from "zod";

export const ToolProvider = z.enum(["claude-code", "codex"]);
export const ToolKind = z.enum(["skill", "mcp", "plugin", "connector", "hook"]);
export type ToolKind = z.infer<typeof ToolKind>;

/** What a tool gives the agent: what it knows how to do, what it can reach, its plugins, and what runs by itself. */
export const ToolGroup = z.enum(["skills", "connections", "plugins", "automatic"]);
export type ToolGroup = z.infer<typeof ToolGroup>;
export const TOOL_GROUPS: Record<ToolGroup, { title: string; help: string }> = {
  skills: { title: "Skills", help: "What the agent knows how to do." },
  connections: { title: "Connections", help: "What the agent can reach: servers and connectors." },
  plugins: { title: "Plugins", help: "Bundles that add skills, connections and commands." },
  automatic: { title: "Automatic actions", help: "Things that run by themselves when something happens." },
};
export const groupOf = (kind: ToolKind): ToolGroup =>
  kind === "skill" ? "skills" : kind === "plugin" ? "plugins" : kind === "hook" ? "automatic" : "connections";

export const ToolEntry = z.object({
  id: z.string(),
  provider: ToolProvider,
  kind: ToolKind,
  name: z.string(),
  path: z.string(),
  detail: z.string().optional(),
  projectId: z.string().nullable(),
  disabled: z.boolean(),
  /** A plain name and one line saying what it does; the file, key and command are the details. */
  title: z.string().default(""),
  description: z.string().default(""),
  /** The setting key (or event) the entry is stored under. */
  configKey: z.string().default(""),
  /** The command or address behind a connection or an automatic action. */
  command: z.string().optional(),
});
export type ToolEntry = z.infer<typeof ToolEntry>;

export const ToolEdit = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["remove", "disable", "enable", "move"]),
    id: z.string(),
    projectId: z.string().optional(),
    destination: z.string().optional(),
  }),
  z.object({
    action: z.literal("add"),
    provider: ToolProvider,
    kind: ToolKind,
    projectId: z.string().optional(),
    name: z.string().trim().max(160),
    value: z.string().trim().max(2000),
  }),
]);
export type ToolEdit = z.infer<typeof ToolEdit>;

export const ToolEditPreview = z.object({
  id: z.string(),
  changes: z.array(z.object({ path: z.string(), diff: z.string() })),
});
export type ToolEditPreview = z.infer<typeof ToolEditPreview>;

/** A connection tried before it is saved: an address, a command, or an entry already in the list. */
export const ToolTest = z.union([
  z.object({ address: z.string().trim().min(1).max(2000) }),
  z.object({ command: z.string().trim().min(1).max(2000) }),
  z.object({ id: z.string(), projectId: z.string().optional() }),
]);
export type ToolTest = z.infer<typeof ToolTest>;
export const ToolTestResult = z.object({
  ok: z.boolean(),
  tools: z.number(),
  server: z.string().nullable(),
  error: z.string().nullable(),
});
export type ToolTestResult = z.infer<typeof ToolTestResult>;

/** A plugin that is installed and not yet turned on for the agent. */
export const InstalledPlugin = z.object({ id: z.string(), title: z.string(), description: z.string() });
export type InstalledPlugin = z.infer<typeof InstalledPlugin>;
