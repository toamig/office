import { z } from "zod";
import { WorkflowItem, type WorkflowItem as Item } from "../../../shared/workflow";
import type { Project, Workspace } from "../../../shared/types";
import { privateNotes } from "../vault/scope";

const Result = z.strictObject({ items: z.array(WorkflowItem).max(5) });

export const WORKFLOW_ITEM_FORMAT = [
  'Return only JSON in this shape: {"items":[{"title":"Short title","why":"One or two lines on why it matters",',
  '"projectIds":["existing-workspace-project-id"],"sources":["specific URL or Brain-relative path"],',
  '"firstStep":"A concrete first step"}]}.',
  'Return at most five items. Return {"items":[]} when nothing fits. Each idea needs at least one source.',
  "Use only listed project IDs. An item for multiple projects must use sources that can be shared across those projects.",
].join(" ");

export function parseWorkflowItems(text: string, projects: ReadonlySet<string>): Item[] | null {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  try {
    const result = Result.parse(JSON.parse(fenced?.[1] ?? trimmed));
    if (result.items.some((item) => item.projectIds.some((id) => !projects.has(id)))) return null;
    return result.items.map((item) => ({ ...item, projectIds: [...new Set(item.projectIds)] }));
  } catch {
    return null;
  }
}

export function workflowItemProjects(ws: Workspace | null, root: string, projectId: string | null): Project[] {
  return ws?.projects.filter((project) => !project.archived &&
    (project.id === projectId || !project.vault || !privateNotes(root, project.vault))) ?? [];
}
