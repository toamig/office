import type { Role } from "./types";

/** The effort levels each provider's command accepts (`claude --effort`, Codex `model_reasoning_effort`). */
const EFFORT_LEVELS: Record<string, Array<NonNullable<Role["effort"]>>> = {
  "claude-code": ["low", "medium", "high", "xhigh", "max"],
  // Codex has no "max": Office sends it as "xhigh", so offering both would be one choice twice.
  codex: ["low", "medium", "high", "xhigh"],
};

/** The effort levels a provider accepts; a provider Office knows nothing about gets them all. */
export function effortsFor(provider: string): Array<NonNullable<Role["effort"]>> {
  return EFFORT_LEVELS[provider] ?? ["low", "medium", "high", "xhigh", "max"];
}

/**
 * Whether a model belongs with a provider. Claude Code has a fixed list; Codex has none, so only a model that is
 * plainly another provider's does not fit. Nothing chosen always fits (the tool's own default).
 */
export function modelFits(
  provider: string,
  model: string | undefined,
  known: Record<string, string[]>,
): boolean {
  if (!model) return true;
  const own = known[provider] ?? [];
  if (own.includes(model)) return true;
  if (provider === "claude-code") return false;
  return !Object.entries(known).some(([id, list]) => id !== provider && list.includes(model));
}
