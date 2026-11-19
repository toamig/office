import { Bot, Cpu, User } from "lucide-react";
import { Fragment } from "react";
import { labelOf } from "@shared/tone";
import { StatusBadge } from "./Status";
import { Time } from "./Text";

/** One stage of a pipeline as the diagram draws it. */
export interface DiagramStage {
  id: string;
  /** The role that does the stage. */
  role: string;
  /** The provider's id ("claude-code", "codex"), when the stage has started or is known. */
  provider: string | null;
  /** Whether the owner approves after this stage. */
  gate: boolean;
  /** pending, running, waiting-gate, waiting-permission, approved, done, failed or skipped. */
  status: string;
  startedAt?: string | null;
  /** The builders of a fan-out stage, stacked in the node. */
  variants?: Array<{ n: number; status: string }>;
}

const PROVIDERS: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

/** "plan" reads "Plan", "docs-writer" reads "Docs writer". */
export const sentence = (id: string): string => {
  const words = id.replaceAll(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const providerName = (id: string | null): string =>
  id ? (PROVIDERS[id] ?? sentence(id)) : "no provider yet";

const CURRENT = new Set(["running", "waiting-gate", "waiting-permission"]);

/** The stage the diagram emphasises: the one working or waiting; else the first not done; else the last. */
export function currentStage(stages: DiagramStage[]): number {
  const live = stages.findIndex((s) => CURRENT.has(s.status));
  if (live >= 0) return live;
  const next = stages.findIndex((s) => !["done", "approved", "skipped"].includes(s.status));
  return next >= 0 ? next : Math.max(0, stages.length - 1);
}

function ProviderIcon({ provider }: { provider: string | null }) {
  const Icon = provider === "codex" ? Cpu : Bot;
  return <Icon size={14} aria-hidden />;
}

/**
 * The full diagram: the stages left to right, joined by a line. Each stage is a node with its name, role and provider,
 * its state as a badge and its time. Your approvals are small "You" nodes between stages. The current stage is the
 * one emphasised, with a quiet pulse while it works. Plain markup and CSS, no graph library.
 */
export function PipelineDiagram({
  stages,
  onPick,
  picked,
  testId = "pipeline-diagram",
}: {
  stages: DiagramStage[];
  onPick?: (stageId: string) => void;
  picked?: string;
  testId?: string;
}) {
  const now = currentStage(stages);
  return (
    <ol className="diagram" data-testid={testId} aria-label="Pipeline stages">
      {stages.map((s, i) => {
        const working = s.status === "running";
        return (
          <Fragment key={s.id}>
            <li
              className="diagram-node"
              data-testid="diagram-stage"
              data-stage={s.id}
              data-status={s.status}
              data-current={i === now ? "true" : undefined}
              data-working={working ? "true" : undefined}
              data-picked={picked === s.id ? "true" : undefined}
            >
              <button
                type="button"
                className="diagram-button"
                onClick={() => onPick?.(s.id)}
                disabled={!onPick}
                aria-label={`${sentence(s.id)}: ${labelOf(s.status)}`}
              >
                <span className="diagram-name">{sentence(s.id)}</span>
                <span className="diagram-who">
                  <ProviderIcon provider={s.provider} />
                  {sentence(s.role)}
                  {s.provider ? `, ${providerName(s.provider)}` : ""}
                </span>
                <StatusBadge status={s.status} />
                {s.startedAt && (
                  <span className="diagram-time">
                    <Time iso={s.startedAt} />
                  </span>
                )}
                {s.variants && s.variants.length > 1 && (
                  <span className="diagram-variants" data-testid="diagram-variants">
                    <span className="diagram-count">{s.variants.length} builders</span>
                    {s.variants.map((v) => (
                      <span key={v.n} className="diagram-variant" data-status={v.status}>
                        Builder {v.n}: {labelOf(v.status)}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
            {s.gate && (
              <li className="diagram-you" data-testid="diagram-you" aria-label="You approve here">
                <User size={13} aria-hidden /> You
              </li>
            )}
            {i < stages.length - 1 && !s.gate && <li className="diagram-line" aria-hidden />}
          </Fragment>
        );
      })}
    </ol>
  );
}

/** The compact diagram: one row of small marks, and the current stage's name with who is on it. */
export function PipelineMarks({
  stages,
  testId = "pipeline-marks",
}: {
  stages: DiagramStage[];
  testId?: string;
}) {
  const now = currentStage(stages);
  const here = stages[now];
  return (
    <span className="marks" data-testid={testId}>
      <span className="marks-row" role="img" aria-label={`Stage ${now + 1} of ${stages.length}`}>
        {stages.map((s, i) => (
          <span
            key={s.id}
            className="mark"
            data-status={s.status}
            data-current={i === now ? "true" : undefined}
            title={`${sentence(s.id)}: ${labelOf(s.status)}`}
          />
        ))}
      </span>
      {here && (
        <span className="marks-now" data-testid="marks-now">
          {sentence(here.id)}, {sentence(here.role)}
          {here.provider ? ` (${providerName(here.provider)})` : ""}
        </span>
      )}
    </span>
  );
}
