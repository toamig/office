/** Stages and whole pipelines to start from, with prompts already written. */
export interface StagePreset {
  name: string;
  /** A word to find the role in the workspace by (a role named for it is picked first). */
  roleHint: string;
  gate: boolean;
  worktree: boolean;
  prompt: string;
}

export const STAGE_PRESETS: StagePreset[] = [
  {
    name: "Plan", roleHint: "plan", gate: true, worktree: false,
    prompt: "Read the task and the project, then write a short plan: what to change, in which files, in what order, and how to check it. Do not change any files. Ask the owner about anything that is unclear.",
  },
  {
    name: "Build", roleHint: "build", gate: false, worktree: true,
    prompt: "Do the work the task describes, following the plan if there is one. Keep the change small, run the project's checks, and commit it on the task's branch with a clear message.",
  },
  {
    name: "Review", roleHint: "review", gate: true, worktree: false,
    prompt: "Review the change on the task's branch against the task. Look for bugs, missing cases, unclear code and anything that settles a choice without a decision note. Do not change any files. List what must change and what is optional.",
  },
  {
    name: "Test", roleHint: "test", gate: false, worktree: false,
    prompt: "Run the project's tests and checks on the task's branch. Report what passed and what failed, with the first error of each failure. Fix nothing unless the task asks for it.",
  },
  {
    name: "Document", roleHint: "doc", gate: false, worktree: false,
    prompt: "Update the project's notes and documentation for the change: what changed, why, and anything the next person must know. Keep it short and put each fact in one place.",
  },
];

export interface PipelineTemplate { name: string; stages: string[] }

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  { name: "Plan, build, review", stages: ["Plan", "Build", "Review"] },
  { name: "Build and test", stages: ["Build", "Test"] },
  { name: "Build, test and document", stages: ["Build", "Test", "Document"] },
];

/** The id a stage gets from its name, made once. */
export function idFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stage";
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** The role that suits a preset: one whose id or purpose mentions the hint, else the first. */
export function roleFor(hint: string, roles: Record<string, { purpose?: string | undefined }>): string {
  const ids = Object.keys(roles);
  return ids.find((id) => id.toLowerCase().includes(hint)) ?? ids.find((id) => (roles[id]?.purpose ?? "").toLowerCase().includes(hint)) ?? ids[0] ?? "";
}
