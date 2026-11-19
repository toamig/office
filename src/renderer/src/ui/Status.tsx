import { AlertTriangle, Check, Circle, Clock, Info, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { iconOf, labelOf, toneOf, type StatusIcon, type Tone } from "@shared/tone";

const ICONS: Record<StatusIcon, ReactNode> = {
  check: <Check size={13} aria-hidden />,
  spinner: <Loader2 size={13} className="ui-spin" aria-hidden />,
  attention: <AlertTriangle size={13} aria-hidden />,
  cross: <X size={13} aria-hidden />,
  dot: <Circle size={11} aria-hidden />,
  clock: <Clock size={13} aria-hidden />,
  info: <Info size={13} aria-hidden />,
};

/**
 * The one badge for every status in the app: an icon and a sentence-case word on a soft tint of the status colour,
 * 22 px high, never wrapping. The tone comes from toneOf, so the same status looks the same everywhere.
 */
export function StatusBadge({
  status,
  label,
  tone,
  testId,
}: {
  status: string;
  /** Overrides the word, for a status that needs more than its name. */
  label?: string;
  /** Overrides the tone, for a one-off result that is not in the table. */
  tone?: Tone;
  testId?: string;
}) {
  const t = tone ?? toneOf(status);
  const text = label ?? labelOf(status);
  return (
    <span className="ui-badge" data-tone={t} data-status={status} data-testid={testId} title={text}>
      {ICONS[iconOf(t, status)]}
      <span className="truncate">{text}</span>
    </span>
  );
}

/** A small filled pill for a count. */
export function CountPill({
  count,
  tone = "accent",
  label,
}: {
  count: number;
  tone?: "accent" | "attention" | "muted";
  label?: string;
}) {
  return (
    <span
      className="ui-count"
      data-tone={tone === "accent" ? undefined : tone}
      aria-label={label ?? `${count}`}
    >
      {count}
    </span>
  );
}

/** A key cap. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ui-kbd">{children}</kbd>;
}
