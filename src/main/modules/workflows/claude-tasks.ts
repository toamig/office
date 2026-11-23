import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validCron } from "../../../shared/schedule";
import { Workflow, workflowsFor, type ClaudeTaskView } from "../../../shared/workflow";
import type { Workspace } from "../../../shared/types";
import { frontmatterValue, stripFrontmatter } from "../notes/notes";

/*
 * Claude Code's scheduled tasks, read only. Each task is `<claude home>/scheduled-tasks/<id>/SKILL.md` (name,
 * description, prompt); its schedule, on or off state and folder live in the Claude desktop app's own state file,
 * `<app data>/Claude/claude-code-sessions/<account>/<organisation>/scheduled-tasks.json`.
 *
 * Nothing here writes, moves or deletes: this file imports only the reading functions of node:fs, and a unit
 * test keeps it that way.
 */

export interface ClaudeTask {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** A five-field cron string, or null when the app's state could not be read. */
  schedule: string | null;
  /** On or off in the Claude app; null when its state could not be read. */
  enabled: boolean | null;
  /** The folder the task runs in. */
  cwd: string | null;
  lastRunAt: string | null;
}

interface AppTask {
  id?: unknown; displayName?: unknown; cronExpression?: unknown; enabled?: unknown; cwd?: unknown; lastRunAt?: unknown;
}

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;

function stateFiles(appData: string): Array<{ file: string; time: number }> {
  const found: Array<{ file: string; time: number }> = [];
  const base = join(appData, "Claude", "claude-code-sessions");
  try {
    for (const account of readdirSync(base)) {
      for (const organisation of readdirSync(join(base, account))) {
        const file = join(base, account, organisation, "scheduled-tasks.json");
        try { found.push({ file, time: statSync(file).mtimeMs }); } catch { /* none for this organisation */ }
      }
    }
  } catch { /* the app keeps no state here */ }
  return found.sort((a, b) => b.time - a.time);
}

function appState(appData: string): Map<string, AppTask> {
  const tasks = new Map<string, AppTask>();
  // The newest file first: its entry for a task wins.
  for (const { file } of stateFiles(appData)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as { scheduledTasks?: unknown };
      if (!Array.isArray(data.scheduledTasks)) continue;
      for (const entry of data.scheduledTasks as AppTask[]) {
        const id = text(entry?.id);
        if (id && !tasks.has(id)) tasks.set(id, entry);
      }
    } catch { /* an unreadable state file is the same as none */ }
  }
  return tasks;
}

/** The tasks in a Claude home, with their schedule and state when the app's state file can be read. */
export function readClaudeTasks(claudeHome: string, appData: string): ClaudeTask[] {
  const root = join(claudeHome, "scheduled-tasks");
  let ids: string[];
  try { ids = readdirSync(root); } catch { return []; }
  const state = appState(appData);
  const tasks: ClaudeTask[] = [];
  for (const id of ids.sort()) {
    let skill: string;
    try { skill = readFileSync(join(root, id, "SKILL.md"), "utf8").replaceAll("\r\n", "\n"); } catch { continue; }
    const app = state.get(id);
    const cron = text(app?.cronExpression);
    tasks.push({
      id,
      name: text(app?.displayName) ?? frontmatterValue(skill, "name") ?? id,
      description: frontmatterValue(skill, "description") ?? "",
      prompt: stripFrontmatter(skill).trim(),
      schedule: cron && validCron(cron) ? cron.trim() : null,
      enabled: typeof app?.enabled === "boolean" ? app.enabled : null,
      cwd: text(app?.cwd),
      lastRunAt: text(app?.lastRunAt),
    });
  }
  return tasks;
}

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task";

/**
 * The workflow a Claude task becomes: its prompt, Write in the Brain with web search on, switched off. The
 * owner turns the Claude task off first and then this workflow on.
 */
export function workflowFromClaudeTask(task: ClaudeTask, options: { schedule?: string | null; projectId?: string | null; taken: ReadonlySet<string> }): Workflow {
  let id = slug(task.id);
  for (let n = 2; options.taken.has(id); n += 1) id = `${slug(task.id)}-${n}`;
  const schedule = options.schedule === undefined ? task.schedule : options.schedule;
  return Workflow.parse({
    id, name: task.name.slice(0, 100), schedule, projectId: options.projectId ?? null,
    read: "brain", mayDo: "brain", web: true, output: "note", enabled: false,
    prompt: task.prompt.slice(0, 20_000), fromClaudeTask: task.id,
  });
}

const same = (a: string, b: string): boolean => a.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase() === b.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();

/** The Office project whose folder is the folder a Claude task runs in. */
export function projectOfFolder(workspace: Workspace | null, cwd: string | null, folderOf: (id: string) => string | undefined): { id: string; name: string } | null {
  if (!workspace || !cwd) return null;
  const project = workspace.projects.find((entry) => { const folder = folderOf(entry.id); return folder !== undefined && same(folder, cwd); });
  return project ? { id: project.id, name: project.name } : null;
}

/** The Claude tasks as Workflows lists them: which are moved, and which run in both places. */
export function claudeTaskViews(tasks: ClaudeTask[], workspace: Workspace | null, folderOf: (id: string) => string | undefined): ClaudeTaskView[] {
  const workflows = workflowsFor(workspace);
  return tasks.map((task) => {
    const moved = workflows.find((workflow) => workflow.fromClaudeTask === task.id);
    const project = projectOfFolder(workspace, task.cwd, folderOf);
    return {
      id: task.id, name: task.name, description: task.description, schedule: task.schedule, enabled: task.enabled,
      projectName: project?.name ?? null, projectId: project?.id ?? null, lastRunAt: task.lastRunAt,
      movedAs: moved ? { id: moved.id, name: moved.name, enabled: moved.enabled } : null,
      runsTwice: task.enabled === true && moved?.enabled === true && moved.schedule !== null,
    };
  });
}
