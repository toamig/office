/*
 * What a pipeline stage is sent. The engine and the Preview use the same function, so what the owner sees is what the
 * stage gets. The stored form of a variable stays `{{task.description}}`; the editor shows it as a chip with a plain
 * name, and `unknownVariables` marks one that does not exist while it is typed.
 */

export interface StageLike {
  id: string;
  name?: string | undefined;
  prompt: string;
  /** Earlier stages whose result this stage does not get. */
  exclude?: string[] | undefined;
}

export interface TaskFacts {
  id: string;
  title: string;
  description: string;
  project: string;
  /** The project's id, which the older `{{task.project}}` placeholder gave. */
  projectId: string;
  branch: string | null;
  worktree: string | null;
}

/** An earlier stage as the stage after it sees it. */
export interface EarlierResult {
  id: string;
  name: string;
  /** The text of the result, or null when the stage produced none. */
  text: string | null;
  path: string;
}

/** A result this short is put in the prompt as it is; a longer one is a file to read. */
export const INLINE_RESULT_LIMIT = 1500;

const humanise = (id: string): string => {
  const words = id.replaceAll(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
export const stageName = (stage: Pick<StageLike, "id" | "name">): string => stage.name?.trim() || humanise(stage.id);

export interface VariableOption { key: string; label: string; group: "Task" | "Stages" }

export const TASK_VARIABLES: VariableOption[] = [
  { key: "task.title", label: "Task title", group: "Task" },
  { key: "task.description", label: "Task description", group: "Task" },
  { key: "task.project", label: "Project", group: "Task" },
  { key: "task.branch", label: "Branch", group: "Task" },
  { key: "task.worktree", label: "Worktree folder", group: "Task" },
  { key: "task.id", label: "Task number", group: "Task" },
];

/** Every variable the stage at `index` can name, with a plain label: the task, this stage's file, earlier stages' files. */
export function variablesFor(stages: StageLike[], index: number): VariableOption[] {
  return [
    ...TASK_VARIABLES,
    { key: "stage.outputPath", label: "This stage's result file", group: "Stages" },
    ...stages.slice(0, index).map((stage): VariableOption => ({
      key: `stages.${stage.id}.outputPath`, label: `${stageName(stage)} stage result file`, group: "Stages",
    })),
  ];
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** The names of the variables a prompt uses, in order. */
export function variablesIn(prompt: string): string[] {
  return [...prompt.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/** The variables a prompt uses that no stage of the pipeline could provide. */
export function unknownVariables(prompt: string, stages: StageLike[]): string[] {
  const known = new Set<string>([
    ...TASK_VARIABLES.map((variable) => variable.key), "stage.id", "stage.outputPath",
    ...stages.map((stage) => `stages.${stage.id}.outputPath`),
  ]);
  return [...new Set(variablesIn(prompt).filter((name) => !known.has(name)))];
}

/** The label a chip shows for a variable; an unknown one shows its raw name. */
export function variableLabel(key: string, stages: StageLike[], index: number): string {
  return variablesFor(stages, stages.length).find((option) => option.key === key)?.label
    ?? (key === "stage.id" ? "This stage's name" : stages[index] && key === "stage.outputPath" ? "This stage's result file" : key);
}

/** Fills the `{{ }}` placeholders; a name with no value is an error naming it. */
export function fillPlaceholders(template: string, values: Record<string, string | null | undefined>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null) throw new Error(`Unknown placeholder {{${key}}} in the stage prompt`);
    return value;
  });
}

export interface StageContext {
  task: TaskFacts;
  /** Where this stage's result goes, and where every stage of the pipeline keeps its own. */
  outputPath: (stageId: string) => string;
  /** The earlier stages' results, in order. */
  earlier: EarlierResult[];
}

/** The text of the "What you have" block: the task and the result of every earlier stage that is included. */
export function whatYouHave(stage: StageLike, context: StageContext): string {
  const { task } = context;
  const left = new Set(stage.exclude ?? []);
  const lines = [
    "## What you have",
    "",
    `Task: ${task.title}`,
    `Description: ${task.description.trim() || "(none)"}`,
    `Project: ${task.project}`,
    ...(task.branch ? [`Branch: ${task.branch}`] : []),
    ...(task.worktree ? [`Worktree folder: ${task.worktree}`] : []),
  ];
  for (const result of context.earlier.filter((item) => !left.has(item.id))) {
    lines.push("", `### Result of the ${result.name} stage`);
    const text = result.text?.trim();
    if (!text) lines.push("It produced no result.");
    else if (text.length <= INLINE_RESULT_LIMIT) lines.push(text);
    else lines.push(`It is long. Read it in ${result.path}`);
  }
  return lines.join("\n");
}

/** What the stage receives: its own prompt with the variables filled, then the "What you have" block. */
export function buildStagePrompt(stage: StageLike, context: StageContext): string {
  const { task } = context;
  const values: Record<string, string | null> = {
    "task.id": task.id, "task.title": task.title, "task.description": task.description, "task.branch": task.branch,
    "task.worktree": task.worktree, "task.project": task.projectId, "stage.id": stage.id,
    "stage.outputPath": context.outputPath(stage.id),
  };
  for (const result of context.earlier) values[`stages.${result.id}.outputPath`] = result.path;
  // A later stage's file has no result yet, but its path is still a path (older pipelines name them).
  const lookup = new Proxy(values, {
    get: (target, key: string) => target[key] ?? (/^stages\.[\w-]+\.outputPath$/.test(key) ? context.outputPath(key.slice(7, -11)) : undefined),
  });
  return `${fillPlaceholders(stage.prompt, lookup)}

${whatYouHave(stage, context)}`;
}

export const SAMPLE_TASK: TaskFacts = {
  id: "0000", title: "Add a dark mode", description: "Add a theme switch to the settings page and remember the choice.",
  project: "Your project", projectId: "your-project", branch: null, worktree: null,
};

/** What a stage would be sent for a made-up task, for a pipeline that is still being edited. */
export function samplePrompt(stages: Array<StageLike & { worktree?: boolean }>, index: number): string {
  const stage = stages[index];
  if (!stage) return "";
  const worktree = stages.slice(0, index + 1).some((entry) => entry.worktree);
  const task: TaskFacts = worktree
    ? { ...SAMPLE_TASK, branch: "office/add-a-dark-mode", worktree: "(the task's worktree folder)" }
    : SAMPLE_TASK;
  const folder = "(the task's folder)";
  return buildStagePrompt(stage, {
    task,
    outputPath: (id) => `${folder}/${id}.md`,
    earlier: stages.slice(0, index).map((entry) => ({
      id: entry.id, name: stageName(entry), path: `${folder}/${entry.id}.md`,
      text: `(What the ${stageName(entry)} stage wrote appears here once it has run.)`,
    })),
  });
}
