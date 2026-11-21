import { z } from "zod";

export const ToolProvider = z.enum(["claude-code", "codex"]);
export const ToolKind = z.enum(["skill", "mcp", "plugin", "connector", "hook"]);
export type ToolKind = z.infer<typeof ToolKind>;

export const ToolEntry = z.object({
  id: z.string(),
  provider: ToolProvider,
  kind: ToolKind,
  name: z.string(),
  path: z.string(),
  detail: z.string().optional(),
  projectId: z.string().nullable(),
  disabled: z.boolean(),
});
export type ToolEntry = z.infer<typeof ToolEntry>;

export const ToolEdit = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["remove", "disable", "move"]),
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
