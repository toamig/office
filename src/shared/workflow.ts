import { z } from "zod";
import { AutonomyLevel } from "./autonomy";
import type { Workspace } from "./types";

export const WorkflowOutput = z.enum(["worth-a-look", "pending", "note"]);
/** What a workflow may do: read only, write notes in the Brain, or work in its project. */
export const WorkflowMayDo = z.enum(["read", "brain", "project"]);
export type WorkflowMayDo = z.infer<typeof WorkflowMayDo>;
export const WorkflowRead = z.enum(["brain", "project", "both", "none"]);

export const Workflow = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(100),
  schedule: z.string().trim().min(1).nullable(),
  projectId: z.string().nullable(),
  read: WorkflowRead.default("brain"),
  provider: z.string().optional(),
  model: z.string().optional(),
  mayDo: WorkflowMayDo.default("read"),
  /** Web search and fetch, on by default at every level. */
  web: z.boolean().default(true),
  /** The autonomy of a workflow that works in its project (never asks, since nobody is there). */
  autonomy: AutonomyLevel.optional(),
  prompt: z.string().trim().min(1).max(20_000),
  output: WorkflowOutput.default("worth-a-look"),
  enabled: z.boolean().default(true),
  template: z.literal("brain-upkeep").optional(),
});
export type Workflow = z.infer<typeof Workflow>;

export const brainUpkeepTemplate: Workflow = {
  id: "brain-upkeep", name: "Brain upkeep", schedule: "0 8 * * 1", projectId: null,
  read: "brain", mayDo: "read", web: false, output: "worth-a-look", enabled: false, template: "brain-upkeep",
  prompt: [
    "Review the Brain using its rule pack and the validation size warnings supplied by Office.",
    "Follow the routers to compare relevant notes. Look for duplicate facts across current projects, contradictions, settled decisions without an ADR, and long notes that answer several questions.",
    "Only suggest a shared note when two current projects need the same stable fact and a divergence would be a bug. Follow the pack's placement and extraction guidance.",
    "Give up to five supported suggestions with precise note paths and headings, the projects affected, and the first step the owner could approve in a discussion. Return no items when none are supported.",
    "Review only. Do not edit files, run commands, or access private notes belonging to another project.",
  ].join("\n"),
};

export const WorkflowRunStatus = z.enum(["running", "done", "failed", "cancelled"]);
export const WorkflowView = Workflow.extend({
  valid: z.boolean(),
  lastFiredAt: z.string().nullable(),
  nextRun: z.string().nullable(),
  lastRun: z.object({
    status: WorkflowRunStatus, result: z.string().nullable(),
    /** The slot this run was for when Office was closed at that time. */
    lateFor: z.string().nullable().default(null),
  }).nullable(),
  /** The next three runs. */
  upcoming: z.array(z.string()).default([]),

});
export type WorkflowView = z.infer<typeof WorkflowView>;

const itemText = (max: number) => z.string().trim().min(1).max(max);
export const WorkflowItem = z.strictObject({
  title: itemText(160),
  why: itemText(480).refine((text) => text.split(/\r\n|\r|\n/).length <= 2, "Use at most two lines"),
  projectIds: z.array(itemText(128)).max(10),
  sources: z.array(itemText(600)).min(1).max(8),
  firstStep: itemText(600),
});
export type WorkflowItem = z.infer<typeof WorkflowItem>;

export const WorkflowResult = WorkflowItem.extend({
  id: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  runId: z.string(),
  createdAt: z.string(),
  why: z.string(),
  sources: z.array(z.string()),
  firstStep: z.string(),
});
export type WorkflowResult = z.infer<typeof WorkflowResult>;

export const workflowOutputLabels: Record<Workflow["output"], string> = {
  "worth-a-look": "Worth a look", pending: "Needs you", note: "Brain note",
};

export const workflowMayDoLabels: Record<WorkflowMayDo, string> = {
  read: "Read only", brain: "Write in the Brain", project: "Work in the project",
};

export const workflowReadLabels: Record<Workflow["read"], string> = {
  brain: "Brain notes", project: "Project files", both: "Project files and Brain notes", none: "Prompt only",
};

export { describeSchedule } from "./schedule";

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
      mayDo: "read", web: true, prompt: automation.prompt, enabled: automation.enabled,
      output: "worth-a-look", ...(role?.provider ? { provider: role.provider } : {}),
      ...(role?.model ? { model: role.model } : {}),
    }];
  });
  return [...saved, ...legacy];
}
