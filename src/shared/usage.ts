import { z } from "zod";

/*
 * What the agent programs report about usage, checked against the installed programs (2026-11-23):
 * - Claude Code: the final `result` line of `claude -p --output-format stream-json` carries `usage`
 *   (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens), `total_cost_usd`,
 *   `duration_ms` and `modelUsage` (the same counts and costUSD per model). With a Claude subscription login it
 *   also writes `rate_limit_event` lines: rate_limit_info.unifiedWindows.five_hour and .seven_day, each with
 *   utilization (0 to 1) and resetsAt (epoch seconds). With an API key it writes no such event.
 * - Codex: `codex exec --json` ends a turn with `turn.completed.usage` (input_tokens including the cached
 *   part, cached_input_tokens, output_tokens including reasoning). It reports no cost and no plan limits on that stream.
 */

export const UsageKind = z.enum(["chat", "workflow", "builder", "recorder", "brief", "upkeep", "other"]);
export type UsageKind = z.infer<typeof UsageKind>;
export const USAGE_KIND_LABELS: Record<UsageKind, string> = {
  chat: "Chat and sessions", workflow: "Workflows", builder: "Builders", recorder: "Recorder", brief: "Brief", upkeep: "Upkeep", other: "Other",
};

/** One model's share of a turn or a run. */
export const UsageReport = z.object({
  model: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  /** What the turn would cost at the API's list prices; null when the program reports no cost. */
  costUsd: z.number().nullable(),
  durationMs: z.number().nullable(),
});
export type UsageReport = z.infer<typeof UsageReport>;

/** One plan window (the five-hour window, the weekly limit) as the program last reported it. */
export const LimitWindow = z.object({
  key: z.string(),
  label: z.string(),
  /** 0 to 1. */
  utilization: z.number(),
  resetsAt: z.string().nullable(),
  status: z.string().nullable(),
});
export type LimitWindow = z.infer<typeof LimitWindow>;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const optionalNum = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The usage of one Claude `result` line, one entry per model when the line breaks it down. */
export function claudeUsage(result: Json): UsageReport[] {
  const duration = optionalNum(result["duration_ms"]);
  const byModel = Object.entries(obj(result["modelUsage"]));
  if (byModel.length > 0) {
    return byModel.map(([model, raw], index) => {
      const entry = obj(raw);
      return {
        model,
        inputTokens: num(entry["inputTokens"]),
        outputTokens: num(entry["outputTokens"]),
        cacheReadTokens: num(entry["cacheReadInputTokens"]),
        cacheWriteTokens: num(entry["cacheCreationInputTokens"]),
        costUsd: optionalNum(entry["costUSD"]),
        durationMs: index === 0 ? duration : null,
      };
    });
  }
  const usage = obj(result["usage"]);
  if (Object.keys(usage).length === 0 && result["total_cost_usd"] === undefined) return [];
  return [{
    model: null,
    inputTokens: num(usage["input_tokens"]),
    outputTokens: num(usage["output_tokens"]),
    cacheReadTokens: num(usage["cache_read_input_tokens"]),
    cacheWriteTokens: num(usage["cache_creation_input_tokens"]),
    costUsd: optionalNum(result["total_cost_usd"]),
    durationMs: duration,
  }];
}

/** The usage of one Codex `turn.completed` line; Codex reports no cost. */
export function codexUsage(event: Json, model: string | null = null, durationMs: number | null = null): UsageReport[] {
  const usage = obj(event["usage"]);
  if (Object.keys(usage).length === 0) return [];
  return [{
    model,
    // Codex counts cached tokens inside input_tokens and reasoning inside output_tokens; the totals here match its own.
    inputTokens: Math.max(0, num(usage["input_tokens"]) - num(usage["cached_input_tokens"])),
    outputTokens: num(usage["output_tokens"]),
    cacheReadTokens: num(usage["cached_input_tokens"]),
    cacheWriteTokens: num(usage["cache_write_input_tokens"]),
    costUsd: null,
    durationMs,
  }];
}

const WINDOW_LABELS: Record<string, string> = { five_hour: "5-hour window", seven_day: "Weekly limit", seven_day_opus: "Weekly limit (Opus)", seven_day_sonnet: "Weekly limit (Sonnet)", overage: "Extra usage" };

/** The plan windows of a Claude `rate_limit_event` line. */
export function claudeLimits(event: Json): LimitWindow[] {
  const info = obj(event["rate_limit_info"]);
  const status = typeof info["status"] === "string" ? info["status"] : null;
  const epoch = (value: unknown): string | null => (typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null);
  const windows = Object.entries(obj(info["unifiedWindows"])).flatMap(([key, raw]) => {
    const window = obj(raw);
    const utilization = optionalNum(window["utilization"]);
    return utilization === null ? [] : [{ key, label: WINDOW_LABELS[key] ?? key.replaceAll("_", " "), utilization, resetsAt: epoch(window["resetsAt"]), status: null }];
  });
  if (windows.length > 0) {
    const kind = typeof info["rateLimitType"] === "string" ? info["rateLimitType"] : null;
    return windows.map((window) => (window.key === kind ? { ...window, status } : window));
  }
  const kind = typeof info["rateLimitType"] === "string" ? info["rateLimitType"] : null;
  const utilization = optionalNum(info["utilization"]);
  return kind && utilization !== null ? [{ key: kind, label: WINDOW_LABELS[kind] ?? kind.replaceAll("_", " "), utilization, resetsAt: epoch(info["resetsAt"]), status }] : [];
}

export const emptyTotals = (): UsageTotals => ({ turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, tokens: 0 });

export const UsageTotals = z.object({
  turns: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  costUsd: z.number(),
  /** Input plus output plus cache tokens, the figure a heading shows. */
  tokens: z.number(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

export const UsageRow = z.object({ key: z.string(), label: z.string(), totals: UsageTotals, link: z.object({ view: z.string(), params: z.record(z.string(), z.string()).optional() }).nullable() });
export type UsageRow = z.infer<typeof UsageRow>;

export const UsageView = z.object({
  today: UsageTotals,
  week: UsageTotals,
  month: UsageTotals,
  /** The last 30 days, oldest first. */
  daily: z.array(z.object({ day: z.string(), tokens: z.number(), costUsd: z.number() })),
  byProject: z.array(UsageRow),
  byKind: z.array(UsageRow),
  byModel: z.array(UsageRow),
  byProgram: z.array(UsageRow),
  sessions: z.array(UsageRow),
  workflows: z.array(UsageRow),
  /** Cost is "API-equivalent": the plans are subscriptions. */
  limits: z.object({
    claudeCode: z.array(LimitWindow).nullable(),
    updatedAt: z.string().nullable(),
  }),
});
export type UsageView = z.infer<typeof UsageView>;
