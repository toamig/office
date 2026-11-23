import { durationWords } from "@shared/cloud";
import type { UsageRow, UsageTotals } from "@shared/usage";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { Banner, Card, EmptyState, Muted, Page } from "../ui";
import { formatCost, formatTokens, LimitBars } from "../components/UsageMeter";

function Stat({ label, totals }: { label: string; totals: UsageTotals }) {
  return (
    <div className="grid gap-0.5">
      <span className="ui-muted">{label}</span>
      <span className="text-[length:var(--text-lg)] font-semibold tabular-nums">{formatTokens(totals.tokens)}</span>
      <span className="ui-muted tabular-nums">{formatCost(totals.costUsd)} {"·"} {totals.turns} {totals.turns === 1 ? "turn" : "turns"}</span>
    </div>
  );
}

function Breakdown({ title, rows, empty }: { title: string; rows: UsageRow[]; empty?: string }) {
  const navigate = useUi((state) => state.navigate);
  const most = Math.max(1, ...rows.map((row) => row.totals.tokens));
  return (
    <Card title={title}>
      {rows.length === 0 ? <Muted>{empty ?? "Nothing recorded yet."}</Muted> : (
        <div className="grid gap-1.5">
          {rows.map((row) => {
            const body = (
              <>
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="usage-bar" aria-hidden><span style={{ width: `${Math.max(2, (row.totals.tokens / most) * 100)}%` }} /></span>
                <span className="ui-muted text-right tabular-nums">{formatTokens(row.totals.tokens)}</span>
              </>
            );
            return row.link
              ? <button key={row.key} type="button" className="usage-row usage-link" onClick={() => navigate(row.link!.view as never, row.link!.params)}>{body}</button>
              : <div key={row.key} className="usage-row">{body}</div>;
          })}
        </div>
      )}
    </Card>
  );
}

/** Cloud routine runs by count and time. The routines API reports no tokens, so there are none to show. */
function CloudUsage() {
  const cloud = useQuery("cloud.usage", undefined, ["cloud.changed"]);
  const data = cloud.data;
  if (!data || data.runs === 0) return null;
  return (
    <Card title="Cloud routine runs" testId="usage-cloud">
      <p className="ui-muted pb-2">
        {data.runs} {data.runs === 1 ? "run" : "runs"} in the last 30 days{durationWords(data.seconds) ? `, ${durationWords(data.seconds)} in all` : ""}.
        Claude reports no tokens for cloud routines, so only counts and time are shown.
      </p>
      <div className="grid gap-1.5">
        {data.routines.map((routine) => (
          <div key={routine.id} className="usage-row">
            <span className="min-w-0 truncate">{routine.name}</span>
            <span aria-hidden />
            <span className="ui-muted text-right tabular-nums">
              {routine.runs} {routine.runs === 1 ? "run" : "runs"}{durationWords(routine.seconds) ? ` · ${durationWords(routine.seconds)}` : ""}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Tokens and API-equivalent cost, as the agent programs reported them: totals, a daily chart and breakdowns. */
export function Usage() {
  const usage = useQuery("usage.summary", undefined, ["usage.changed"]);
  const view = usage.data;
  const most = Math.max(1, ...(view?.daily.map((day) => day.tokens) ?? []));
  return (
    <Page title="Usage" subtitle="What your agents used, as the programs report it." testId="usage">
      {usage.error && <Banner tone="danger">{usage.error}</Banner>}
      {view && view.month.turns === 0 && <EmptyState title="Nothing recorded yet">Usage appears here after an agent finishes a turn.</EmptyState>}
      {view && view.month.turns > 0 && <>
        <Card title="Totals">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Today" totals={view.today} />
            <Stat label="Last 7 days" totals={view.week} />
            <Stat label="Last 30 days" totals={view.month} />
          </div>
          <p className="ui-muted pt-3">
            Cost is the API-equivalent cost: what the same tokens would cost at list prices. Your plans are subscriptions, so it is not a bill.
            Codex reports tokens only.
          </p>
        </Card>
        <Card title="Plan limits">
          {view.limits.claudeCode
            ? <LimitBars windows={view.limits.claudeCode} updatedAt={view.limits.updatedAt} />
            : <Muted>Claude Code reports plan limits only when you are signed in with a Claude subscription, and none has been reported yet. Codex reports no plan limits to Office.</Muted>}
        </Card>
        <Card title="Last 30 days">
          <div className="usage-chart" role="img" aria-label="Tokens per day for the last 30 days">
            {view.daily.map((day) => (
              <div key={day.day} className="usage-day" title={`${day.day}: ${formatTokens(day.tokens)}, ${formatCost(day.costUsd)}`}>
                <span style={{ height: `${day.tokens === 0 ? 0 : Math.max(3, (day.tokens / most) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="ui-muted flex justify-between pt-1">
            <span>{view.daily[0]?.day}</span><span>{view.daily.at(-1)?.day}</span>
          </div>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="By project" rows={view.byProject} />
          <Breakdown title="By kind" rows={view.byKind} />
          <Breakdown title="By model" rows={view.byModel} />
          <Breakdown title="By agent program" rows={view.byProgram} />
          <Breakdown title="Heaviest sessions" rows={view.sessions} empty="No session has used tokens yet." />
          <Breakdown title="Heaviest workflows" rows={view.workflows} empty="No workflow has used tokens yet." />
        </div>
      </>}
      <CloudUsage />
    </Page>
  );
}
