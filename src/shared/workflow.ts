import { z } from "zod";
import type { Workspace } from "./types";

export const WorkflowOutput = z.enum(["worth-a-look", "pending", "note"]);
export const WorkflowRead = z.enum(["brain", "project", "both", "none"]);

export const Workflow = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(100),
  schedule: z.string().trim().min(1).nullable(),
  projectId: z.string().nullable(),
  read: WorkflowRead.default("brain"),
  provider: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().trim().min(1).max(20_000),
  output: WorkflowOutput.default("worth-a-look"),
  enabled: z.boolean().default(true),
});
export type Workflow = z.infer<typeof Workflow>;

export const WorkflowView = Workflow.extend({
  valid: z.boolean(),
  lastFiredAt: z.string().nullable(),
  nextRun: z.string().nullable(),
});
export type WorkflowView = z.infer<typeof WorkflowView>;

export const WorkflowResult = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  projectId: z.string().nullable(),
});
export type WorkflowResult = z.infer<typeof WorkflowResult>;

export function workflowsFor(workspace: Workspace | null): Workflow[] {
  if (!workspace) return [];
  const saved = workspace.workflows ?? [];
  const ids = new Set(saved.map((workflow) => workflow.id));
  const legacy = workspace.automations.flatMap((automation): Workflow[] => {
    if (ids.has(automation.id)) return [];
    const project = workspace.projects.find((entry) => entry.id === automation.project);
    const role = workspace.roles[project?.roles?.[automation.role] ?? automation.role];
    return [{
      id: automation.id, name: automation.id, schedule: automation.cron,
      projectId: automation.project, read: workspace.vault.kind === "none" ? "project" : "both",
      prompt: automation.prompt, enabled: automation.enabled,
      output: "worth-a-look", ...(role?.provider ? { provider: role.provider } : {}),
      ...(role?.model ? { model: role.model } : {}),
    }];
  });
  return [...saved, ...legacy];
}
