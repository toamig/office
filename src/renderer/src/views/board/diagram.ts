import type { TaskDetail, TaskView } from "@shared/models";
import type { DiagramStage } from "../../ui";

/** A task's stages as the pipeline diagram draws them. A fan-out stage carries its builders. */
export function diagramStages(t: TaskView | TaskDetail): DiagramStage[] {
  const variants = "variants" in t ? t.variants : [];
  const buildIdx = t.stages.findIndex((s) => s.worktree);
  return t.stages.map((s, i) => ({
    id: s.stageId,
    role: s.role,
    provider: s.provider,
    gate: s.gate,
    status: s.status,
    startedAt: s.startedAt,
    ...(i === buildIdx && variants.length > 1
      ? { variants: variants.map((v) => ({ n: v.n, status: v.status })) }
      : {}),
  }));
}
