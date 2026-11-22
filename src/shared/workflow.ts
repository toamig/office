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
  template: z.literal("brain-upkeep").optional(),
});
export type Workflow = z.infer<typeof Workflow>;

export const brainUpkeepTemplate: Workflow = {
  id: "brain-upkeep", name: "Brain upkeep", schedule: "0 8 * * 1", projectId: null,
  read: "brain", output: "worth-a-look", enabled: false, template: "brain-upkeep",
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
  lastRun: z.object({ status: WorkflowRunStatus, result: z.string().nullable() }).nullable(),
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

export const workflowReadLabels: Record<Workflow["read"], string> = {
  brain: "Brain notes", project: "Project files", both: "Project files and Brain notes", none: "Prompt only",
};

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayName(value: string): string | undefined {
  if (/^[0-7]$/.test(value)) return weekdays[Number(value) % 7];
  return weekdays.find((day) => day.slice(0, 3).toLowerCase() === value.toLowerCase());
}

function describeWeekdays(pattern: string): string | undefined {
  const parts = pattern.split(",").map((part) => {
    const [first, last, extra] = part.split("-");
    if (!first || extra !== undefined) return undefined;
    const start = weekdayName(first);
    const end = last === undefined ? undefined : weekdayName(last);
    if (!start || (last !== undefined && !end)) return undefined;
    return end ? `${start} through ${end}` : start;
  });
  return parts.every(Boolean) ? parts.join(", ") : undefined;
}

export function describeSchedule(schedule: string | null): string {
  if (!schedule) return "On demand";
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return "Custom schedule";
  const [minute, hour, day, month, weekday] = fields;
  if (schedule === "* * * * *") return "Every minute";
  if (minute && /^\*\/\d+$/.test(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*")
    return `Every ${minute.slice(2)} minutes`;
  if (minute && /^\d{1,2}$/.test(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*")
    return Number(minute) === 0 ? "Every hour" : `At minute ${Number(minute)} of every hour`;
  if (minute && hour && /^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && month === "*") {
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    if (day === "*" && weekday === "*") return `Daily at ${time}`;
    if (day === "*" && weekday) {
      const days = describeWeekdays(weekday);
      if (days) return `Every ${days} at ${time}`;
    }
    if (day && /^\d{1,2}$/.test(day) && weekday === "*") return `Day ${day} of each month at ${time}`;
  }
  return "Custom schedule";
}

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
