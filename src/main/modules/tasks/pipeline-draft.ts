import { z } from "zod";
import { idFromName, roleFor } from "../../../shared/pipeline-presets";
import type { Pipeline, Role } from "../../../shared/types";
import type { RunService } from "../runs/service";

const Draft = z.object({
  name: z.string().trim().min(1).max(100),
  stages: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    role: z.string().optional(),
    gate: z.boolean().optional(),
    worktree: z.boolean().optional(),
    prompt: z.string().trim().min(1).max(4000),
  })).min(1).max(8),
});

/** What the model is asked to write: one JSON object, nothing else. */
export function draftPrompt(description: string, roles: Record<string, Pick<Role, "purpose">>): string {
  return [
    "Draft a pipeline for a software task manager from the owner's description.",
    "A pipeline is a list of stages. Each stage is done by one role, may need the owner's approval afterwards (gate), and may work in its own git worktree (worktree, for stages that change code).",
    "Every stage's prompt says what that stage must do. Do not mention earlier stages' files: each stage is given the task and the results of the stages before it automatically.",
    `Roles you may use: ${Object.entries(roles).map(([id, role]) => `${id}${role.purpose ? ` (${role.purpose})` : ""}`).join(", ") || "none"}.`,
    `Owner's description: ${description.trim()}`,
    'Reply with only a JSON object: {"name": "...", "stages": [{"name": "Plan", "role": "<role id>", "gate": true, "worktree": false, "prompt": "..."}]}',
  ].join("\n");
}

/** Reads the model's reply into a pipeline the editor can show; roles it invented are replaced by one that exists. */
export function parseDraft(text: string, roles: Record<string, Pick<Role, "purpose">>): Pipeline {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The draft was not a pipeline.");
  const draft = Draft.parse(JSON.parse(text.slice(start, end + 1)));
  const ids = new Set<string>();
  return {
    name: draft.name,
    stages: draft.stages.map((stage) => {
      const id = idFromName(stage.name, ids);
      ids.add(id);
      const given = stage.role?.trim().toLowerCase();
      const role = Object.keys(roles).find((roleId) => roleId.toLowerCase() === given) ?? roleFor(stage.name.toLowerCase(), roles);
      return { id, name: stage.name, role, exclude: [], gate: stage.gate ?? false, worktree: stage.worktree ?? false, prompt: stage.prompt };
    }),
  };
}

/** Asks the cheapest agent to draft a pipeline from a sentence, for the owner to edit before saving. */
export async function draftPipeline(
  deps: { runs: RunService; provider: () => string; cwd: () => string },
  description: string,
  roles: Record<string, Pick<Role, "purpose">>,
): Promise<Pipeline> {
  const provider = deps.provider();
  const handle = deps.runs.start({
    kind: "route", title: "Pipeline draft", providerId: provider, cwd: deps.cwd(), prompt: draftPrompt(description, roles), tools: "",
    role: { provider, model: provider === "codex" ? "gpt-5.4-mini" : "haiku", instructions: "", readOnly: true, allowedCommands: [] },
  });
  const result = await handle.result;
  if (!result.ok) throw new Error(result.error ?? "The agent could not draft a pipeline.");
  return parseDraft(result.resultText, roles);
}
