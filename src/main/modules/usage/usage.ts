import { randomUUID } from "node:crypto";
import type { Db } from "../../core/db";
import {
  USAGE_KIND_LABELS, UsageKind, emptyTotals, type LimitWindow, type UsageReport, type UsageRow, type UsageTotals, type UsageView,
} from "../../../shared/usage";

/** Who and what a turn belongs to. */
export interface UsageContext {
  provider: string;
  kind: UsageKind;
  projectId?: string | null;
  sessionId?: string | null;
  workflowId?: string | null;
  runId?: string | null;
  /** Used for a report that names no model. */
  model?: string | null;
}

/** Names and links for the ids a total is kept under. */
export interface UsageNames {
  project: (id: string) => string | undefined;
  session: (id: string) => { title: string; projectId: string | null } | undefined;
  workflow: (id: string) => string | undefined;
}

const localDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

interface Row {
  provider: string; model: string | null; kind: string; project_id: string | null; session_id: string | null;
  workflow_id: string | null; day: string; n: number; i: number; o: number; cr: number; cw: number; cost: number | null;
}

function add(totals: UsageTotals, row: Pick<Row, "n" | "i" | "o" | "cr" | "cw" | "cost">): void {
  totals.turns += row.n;
  totals.inputTokens += row.i;
  totals.outputTokens += row.o;
  totals.cacheReadTokens += row.cr;
  totals.cacheWriteTokens += row.cw;
  totals.costUsd += row.cost ?? 0;
  totals.tokens += row.i + row.o + row.cr + row.cw;
}

/** What the agent programs reported for each turn and background run, kept so the Usage page can add it up. */
export class UsageService {
  constructor(private readonly deps: { db: Db; now?: () => Date; changed?: () => void }) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Records one turn or run; a report with no tokens and no cost is not worth a row. */
  record(context: UsageContext, reports: UsageReport[]): void {
    const at = this.now();
    const insert = this.deps.db.prepare(`INSERT INTO usage (id, at, day, provider, model, kind, project_id, session_id, workflow_id, run_id,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let wrote = false;
    for (const report of reports) {
      if (report.inputTokens + report.outputTokens + report.cacheReadTokens + report.cacheWriteTokens === 0 && !report.costUsd) continue;
      insert.run(randomUUID(), at.toISOString(), localDay(at), context.provider, report.model ?? context.model ?? null, UsageKind.parse(context.kind),
        context.projectId ?? null, context.sessionId ?? null, context.workflowId ?? null, context.runId ?? null,
        report.inputTokens, report.outputTokens, report.cacheReadTokens, report.cacheWriteTokens, report.costUsd, report.durationMs);
      wrote = true;
    }
    if (wrote) this.deps.changed?.();
  }

  /** The plan windows a program last reported; each report replaces the earlier one of the same window. */
  setLimits(provider: string, windows: LimitWindow[]): void {
    if (windows.length === 0) return;
    const at = this.now().toISOString();
    const upsert = this.deps.db.prepare(`INSERT INTO usage_limits (provider, window, label, utilization, resets_at, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (provider, window) DO UPDATE SET label = excluded.label, utilization = excluded.utilization,
      resets_at = excluded.resets_at, status = COALESCE(excluded.status, status), updated_at = excluded.updated_at`);
    for (const window of windows) upsert.run(provider, window.key, window.label, window.utilization, window.resetsAt, window.status, at);
    this.deps.changed?.();
  }

  /** The windows of a program, with those whose reset time has passed dropped, since their figure is no longer true. */
  limits(provider: string): { windows: LimitWindow[]; updatedAt: string | null } {
    const now = this.now().toISOString();
    const rows = this.deps.db.prepare("SELECT window AS key, label, utilization, resets_at AS resetsAt, status, updated_at AS updatedAt FROM usage_limits WHERE provider = ? ORDER BY window")
      .all(provider) as Array<LimitWindow & { updatedAt: string }>;
    const live = rows.filter((row) => !row.resetsAt || row.resetsAt > now);
    return { windows: live.map(({ updatedAt: _updatedAt, ...window }) => window), updatedAt: live.map((row) => row.updatedAt).sort().at(-1) ?? null };
  }

  /** The tokens and cost of one session, and of one run. */
  forSession(sessionId: string): UsageTotals {
    return this.sum("session_id = ?", sessionId);
  }

  forRun(runId: string): UsageTotals {
    return this.sum("run_id = ?", runId);
  }

  private sum(where: string, ...args: string[]): UsageTotals {
    const totals = emptyTotals();
    const row = this.deps.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o,
      COALESCE(SUM(cache_read_tokens), 0) AS cr, COALESCE(SUM(cache_write_tokens), 0) AS cw, SUM(cost_usd) AS cost FROM usage WHERE ${where}`).get(...args) as Row;
    add(totals, row);
    return totals;
  }

  /** Totals for today, 7 and 30 days, a daily series, and the breakdowns the Usage page shows. */
  summary(names: UsageNames): UsageView {
    const now = this.now();
    const dayAgo = (days: number): string => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
    const first = dayAgo(29);
    const rows = this.deps.db.prepare(`SELECT provider, model, kind, project_id, session_id, workflow_id, day, COUNT(*) AS n,
      SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cache_read_tokens) AS cr, SUM(cache_write_tokens) AS cw, SUM(cost_usd) AS cost
      FROM usage WHERE day >= ? GROUP BY provider, model, kind, project_id, session_id, workflow_id, day`).all(first) as Row[];
    const today = emptyTotals();
    const week = emptyTotals();
    const month = emptyTotals();
    const daily = new Map<string, { tokens: number; costUsd: number }>();
    for (let back = 29; back >= 0; back -= 1) daily.set(dayAgo(back), { tokens: 0, costUsd: 0 });
    const group = (): Map<string, UsageTotals> => new Map();
    const groups = { project: group(), kind: group(), model: group(), program: group(), session: group(), workflow: group() };
    const bump = (map: Map<string, UsageTotals>, key: string, row: Row): void => {
      const totals = map.get(key) ?? emptyTotals();
      add(totals, row);
      map.set(key, totals);
    };
    const weekStart = dayAgo(6);
    for (const row of rows) {
      add(month, row);
      if (row.day >= weekStart) add(week, row);
      if (row.day === dayAgo(0)) add(today, row);
      const entry = daily.get(row.day);
      if (entry) { entry.tokens += row.i + row.o + row.cr + row.cw; entry.costUsd += row.cost ?? 0; }
      bump(groups.project, row.project_id ?? "", row);
      bump(groups.kind, row.kind, row);
      bump(groups.model, row.model ?? "", row);
      bump(groups.program, row.provider, row);
      if (row.session_id) bump(groups.session, row.session_id, row);
      if (row.workflow_id) bump(groups.workflow, row.workflow_id, row);
    }
    const rowsOf = (map: Map<string, UsageTotals>, label: (key: string) => string, link: (key: string) => UsageRow["link"], limit = 50): UsageRow[] =>
      [...map].map(([key, totals]) => ({ key, label: label(key), totals, link: link(key) }))
        .sort((a, b) => b.totals.tokens - a.totals.tokens).slice(0, limit);
    const program = (id: string): string => id === "codex" ? "Codex" : id === "claude-code" ? "Claude Code" : id;
    const limits = this.limits("claude-code");
    return {
      today, week, month,
      daily: [...daily].map(([day, value]) => ({ day, ...value })),
      byProject: rowsOf(groups.project, (key) => key ? names.project(key) ?? "A project that is gone" : "No project", (key) => key ? { view: "project", params: { id: key } } : null),
      byKind: rowsOf(groups.kind, (key) => USAGE_KIND_LABELS[key as UsageKind] ?? key, () => null),
      byModel: rowsOf(groups.model, (key) => key || "Not reported", () => null),
      byProgram: rowsOf(groups.program, program, () => null),
      sessions: rowsOf(groups.session, (key) => names.session(key)?.title ?? "A session that is gone", (key) => names.session(key) ? { view: "agents", params: { session: key } } : null, 8),
      workflows: rowsOf(groups.workflow, (key) => names.workflow(key) ?? "A workflow that is gone", (key) => names.workflow(key) ? { view: "workflows" } : null, 8),
      limits: { claudeCode: limits.windows.length > 0 ? limits.windows : null, updatedAt: limits.updatedAt },
    };
  }
}
