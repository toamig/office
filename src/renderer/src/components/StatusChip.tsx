import type { SessionStatus } from "@shared/models";
import { Chip } from "./ui";

/** A session's status in words. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  starting: "Starting",
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
  exited: "Exited",
  failed: "Failed",
};

/** One colour per status, the same wherever it shows: amber for needs you, green for working, red for failed. */
export const STATUS_TONES: Record<SessionStatus, "neutral" | "good" | "warn" | "bad"> = {
  starting: "neutral",
  working: "good",
  "needs-you": "warn",
  idle: "neutral",
  exited: "neutral",
  failed: "bad",
};

/** The status of a session as a chip: words, and the one colour that status always has. */
export function StatusChip({ status }: { status: SessionStatus }) {
  return <Chip tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Chip>;
}
