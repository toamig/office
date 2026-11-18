import { z } from "zod";
import { Workspace } from "./schemas";

/** What the renderer learns about the app configuration. Never includes the relay token. */
export const WorkspaceView = z.object({
  configured: z.boolean(),
  workspaceRoot: z.string(),
  workspaceConfigPath: z.string(),
  projectsRoot: z.string(),
  editorCommand: z.string(),
  workspace: Workspace.nullable(),
  error: z.string().nullable(),
});
export type WorkspaceView = z.infer<typeof WorkspaceView>;
