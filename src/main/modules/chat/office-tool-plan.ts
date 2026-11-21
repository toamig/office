import { z } from "zod";
import { officeTools, type OfficeConfirmation, type OfficeTool, type ToolInput } from "../../../shared/office-tools";
import { describeSchedule, workflowOutputLabels, workflowReadLabels, type Workflow } from "../../../shared/workflow";
import type { Project } from "../../../shared/types";

export type OfficeCall = {
  [K in OfficeTool]: { name: K; input: ToolInput<K> };
}[OfficeTool];

export function readOnlyTool(name: OfficeTool): boolean {
  return name === "office_list_workflows" || name === "office_open";
}

export function parseOfficeCall(name: unknown, input: unknown): OfficeCall {
  if (typeof name !== "string" || !Object.hasOwn(officeTools, name))
    throw new Error("Unknown Office tool.");
  const key = name as OfficeTool;
  return { name: key, input: officeTools[key].input.parse(input) } as OfficeCall;
}

export const officeCatalog = (Object.keys(officeTools) as OfficeTool[]).map((name) => ({
  name, description: officeTools[name].description,
  inputSchema: z.toJSONSchema(officeTools[name].input, { io: "input" }),
  annotations: { readOnlyHint: readOnlyTool(name) },
}));

type Field = OfficeConfirmation["fields"][number];
const labels: Record<string, string> = {
  name: "Name", projectId: "Project", prompt: "Prompt", schedule: "Schedule", model: "Model",
  output: "Result goes to", provider: "Agent tool", read: "May read", enabled: "Enabled",
  visibility: "Visibility", license: "License", stack: "Stack", domain: "Domain", group: "Group",
  firstMessage: "First message", goal: "Goal", text: "Text", date: "Due date", title: "Title",
  description: "Description", pipeline: "Pipeline", fanout: "Builders", decision: "Decision",
};

function choices<T extends string>(options: Record<T, string>): Array<{ label: string; value: string }> {
  return Object.entries<string>(options).map(([value, label]) => ({ label, value }));
}

const workflowKeys = ["name", "projectId", "schedule", "read", "provider", "model", "output", "prompt", "enabled"];
const keysByTool: Partial<Record<OfficeTool, string[]>> = {
  office_create_workflow: workflowKeys,
  office_update_workflow: workflowKeys,
  office_create_project: ["name", "visibility", "license", "stack", "domain", "group"],
  office_start_session: ["projectId", "goal", "firstMessage"],
  office_set_reminder: ["projectId", "date", "text"],
  office_save_note: ["projectId", "text"],
  office_add_waiting: ["projectId", "text"],
  office_create_task: ["projectId", "pipeline", "title", "description", "fanout"],
  office_resolve_item: ["decision"],
};

export function toolFields(
  call: OfficeCall,
  projects: Project[],
  input: Record<string, unknown>,
  pipelines: Array<{ label: string; value: string }>,
): Field[] {
  const options: Partial<Record<string, Field["options"]>> = {
    projectId: projects.map((project) => ({ label: project.name, value: project.id })),
    read: choices(workflowReadLabels), output: choices(workflowOutputLabels), pipeline: pipelines,
    visibility: choices({ private: "Private", public: "Public" }),
    license: choices({ none: "None", mit: "MIT" }),
    domain: choices({ saas: "SaaS", ue5: "Unreal Engine", webgames: "Web game", mobile: "Mobile", meta: "General" }),
  };
  return (keysByTool[call.name] ?? []).map((key) => {
    const value = input[key] as Field["value"];
    return {
      key, label: labels[key] ?? key, value,
      kind: ["prompt", "text", "description", "firstMessage", "decision"].includes(key) ? "multiline"
        : key === "enabled" ? "boolean" : key === "fanout" ? "number" : "text",
      ...(options[key] ? { options: options[key] } : {}),
      ...(["schedule", "projectId"].includes(key) && call.name.includes("workflow") ? { nullable: true } : {}),
    };
  });
}

export function workflowPreview(workflow: Workflow, project: string | undefined): OfficeConfirmation["preview"] {
  return [
    { label: "Name", text: workflow.name },
    { label: "Schedule", text: describeSchedule(workflow.schedule) },
    { label: "Project", text: project ?? "Brain" },
    { label: "Model", text: workflow.model || "Cheapest available" },
    { label: "May read", text: workflowReadLabels[workflow.read] },
    { label: "Result goes to", text: workflowOutputLabels[workflow.output] },
    { label: "Prompt", text: workflow.prompt },
    ...(workflow.schedule && describeSchedule(workflow.schedule) === "Custom schedule" ? [{ label: "Cron expression", text: workflow.schedule }] : []),
  ];
}

export function fieldsPreview(fields: Field[]): OfficeConfirmation["preview"] {
  return fields.flatMap((field) => {
    if (field.value == null || field.value === "") return [];
    const text = field.options?.find((option) => option.value === field.value)?.label ?? String(field.value);
    return [{ label: field.label, text }];
  });
}
