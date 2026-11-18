import type { SessionStatus } from "../../../shared/models";

/** Claude Code hook events to session status (plan 9.2). */
export function statusForClaudeHook(event: string): SessionStatus | null {
  switch (event) {
    case "SessionStart":
      return "idle";
    case "UserPromptSubmit":
      return "working";
    case "Notification":
      return "needs-you";
    case "Stop":
      return "idle";
    case "SessionEnd":
      return "exited";
    default:
      return null;
  }
}

/** Codex notify events: a finished turn means the agent is waiting for the next prompt. */
export function statusForCodexEvent(type: string): SessionStatus | null {
  return type === "agent-turn-complete" ? "idle" : null;
}

export const IDLE_AFTER_MS = 20_000;
/** Terminal echo of the owner's own typing must not count as the agent working. */
export const ECHO_WINDOW_MS = 1_500;

export interface LiveState {
  status: SessionStatus;
  hookSeen: boolean;
  lastOutputMs: number;
  lastWriteMs: number;
  /** True when the tool's hooks report a submitted prompt (Claude Code); Codex's notify does not. */
  promptHook?: boolean;
}

/** Fallback when no hooks report: output starts work; 20 s of silence means idle (plan 9.4). */
export function statusOnOutput(s: LiveState, nowMs: number): SessionStatus | null {
  if (s.hookSeen) {
    if (s.status === "starting") return "working";
    // Codex only reports the end of a turn, so output after the owner's next prompt is the start of one.
    if (!s.promptHook && s.status === "idle" && nowMs - s.lastWriteMs > ECHO_WINDOW_MS)
      return "working";
    return null;
  }
  if (s.status === "starting") return "working";
  if (s.status === "idle" && nowMs - s.lastWriteMs > ECHO_WINDOW_MS) return "working";
  return null;
}

export function statusOnTick(s: LiveState, nowMs: number): SessionStatus | null {
  if (s.hookSeen) return null;
  if (s.status === "working" && nowMs - s.lastOutputMs >= IDLE_AFTER_MS) return "idle";
  return null;
}
