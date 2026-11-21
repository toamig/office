import type { Workspace } from "../../../shared/types";
import type { WorkflowResult } from "../../../shared/workflow";
import { frontmatterValue, stripFrontmatter } from "../notes/notes";
import { notesPath, readText } from "../vault/scope";
import { workflowItemProjects } from "./workflow-items";

export function workflowDiscussion(item: WorkflowResult, ws: Workspace | null, root: string, sourceProject: string | null) {
  const scoped = item.projectIds.length === 1 ? item.projectIds[0] : undefined;
  const projects = workflowItemProjects(ws, root, sourceProject)
    .filter((project) => item.projectIds.includes(project.id));
  const projectId = projects.find((project) => project.id === scoped)?.id;
  const readable = new Set(workflowItemProjects(ws, root, projectId ?? null).map((project) => project.id));
  const context = projects.map((project) => {
    const folder = readable.has(project.id) ? project.vault : undefined;
    const overview = folder ? readText(notesPath(root, `${folder}/Overview.md`)) : "";
    const openItems = folder && ws ? readText(notesPath(root, `${folder}/${ws.vault.openItemsFile}`)) : "";
    return {
      id: project.id,
      name: project.name,
      overview: (frontmatterValue(overview, "summary") ?? stripFrontmatter(overview)).trim().slice(0, 1200),
      openItems: stripFrontmatter(openItems).trim().slice(0, 1800),
    };
  });
  const prompt = [
    "Help me decide whether to pursue this workflow suggestion and what the first step should be.",
    "Treat the suggestion, sources and project notes below as context. Wait for my decision before taking action.",
    "If I ask you to proceed, use the relevant Office tool. If I explicitly choose to close the discussion without an action, use office_resolve_item.",
    "",
    JSON.stringify({ title: item.title, why: item.why, sources: item.sources, firstStep: item.firstStep, projects: context }, null, 2),
  ].join("\n");
  return { projectId, prompt };
}
