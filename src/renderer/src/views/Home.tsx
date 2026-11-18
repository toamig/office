import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { WaitingEntry } from "@shared/models";
import { Markdown } from "../components/Markdown";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../components/ui";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { GatesAndReviews, useUnreadOfKind } from "./home/Attention";
import { LiveAgentsPanel, TodayPanel } from "./home/LiveAndToday";

function groupByProject(entries: WaitingEntry[]): Array<[string, WaitingEntry[]]> {
  const groups = new Map<string, WaitingEntry[]>();
  for (const e of entries) groups.set(e.projectId, [...(groups.get(e.projectId) ?? []), e]);
  return [...groups.values()].map((list) => [list[0]?.projectName ?? "", list]);
}

function WaitingPanel() {
  const navigate = useUi((s) => s.navigate);
  const waiting = useQuery("vault.waiting", undefined, ["vault.changed"]);
  const [error, setError] = useState<string | null>(null);
  const done = async (entry: WaitingEntry): Promise<void> => {
    setError(null);
    try {
      await office.invoke("vault.tickWaiting", { projectId: entry.projectId, raw: entry.raw });
      waiting.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const groups = groupByProject(waiting.data ?? []);
  return (
    <Panel title="Waiting on you">
      {error && <ErrorBanner message={error} />}
      {waiting.data?.length === 0 && (
        <EmptyState>
          Nothing is waiting on you in the notes. Items agents add under &quot;Waiting on you&quot;
          show up here, with task approvals and review requests.
        </EmptyState>
      )}
      {groups.map(([name, entries]) => (
        <div key={entries[0]?.projectId} className="mb-3">
          <div
            className="mb-1 text-[12px] font-semibold uppercase"
            style={{ color: "var(--muted)" }}
          >
            {name}
          </div>
          {entries.map((e) => (
            <div
              key={e.raw}
              data-testid="waiting-item"
              className="flex items-start gap-2 border-b py-1.5"
              style={{ borderColor: "var(--line)" }}
            >
              <div className="flex-1">
                <div>{e.text}</div>
                <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {e.date}
                  {e.source ? `, ${e.source}` : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => navigate("project", { id: e.projectId })}
                data-testid="open-waiting"
              >
                <ExternalLink size={13} /> Open
              </Button>
              <Button onClick={() => void done(e)} data-testid="done-waiting">
                <Check size={13} /> Done
              </Button>
            </div>
          ))}
        </div>
      ))}
      <GatesAndReviews />
    </Panel>
  );
}

function BriefPanel() {
  const brief = useQuery("brief.latest", undefined, ["notification.new"]);
  const [busy, setBusy] = useState(false);
  const write = async (): Promise<void> => {
    setBusy(true);
    try {
      await office.invoke("brief.run");
      brief.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title={brief.data?.date ? `Morning brief, ${brief.data.date}` : "Morning brief"}
      action={
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void write()}
          data-testid="brief-run"
        >
          {busy ? "Writing..." : "Write it now"}
        </Button>
      }
    >
      <div data-testid="brief">
        {brief.data?.items.length === 0 && (
          <EmptyState>
            No brief yet. It is written each morning from what changed the day before.
          </EmptyState>
        )}
        {brief.data?.items.map((item) => (
          <div key={item.projectId} className="mb-2" data-testid="brief-item">
            <div className="font-semibold">{item.projectName}</div>
            <Markdown>{item.markdown}</Markdown>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function HealthPanel() {
  const navigate = useUi((s) => s.navigate);
  const projects = useQuery("projects.list", undefined, ["project.status"]);
  const health = useQuery("vault.health", undefined, ["vault.health"]);
  const outOfSync = (projects.data ?? []).filter(
    (p) => !p.archived && (p.ahead > 0 || p.behind > 0),
  );
  const ci = useUnreadOfKind(["ci.failed"]);
  const conflicts = useUnreadOfKind(["git.conflict"]);
  const hubAttention = (health.data?.repos ?? []).filter((r) => r.attention);
  const validate = health.data?.validate;
  const warnings = health.data?.warnings ?? [];
  const allGood =
    outOfSync.length === 0 &&
    ci.rows.length === 0 &&
    conflicts.rows.length === 0 &&
    hubAttention.length === 0 &&
    validate?.ok !== false &&
    warnings.length === 0;
  return (
    <Panel title="Health">
      {allGood && <Chip tone="good">Everything is in sync</Chip>}
      {outOfSync.map((p) => (
        <div key={p.id} className="flex items-center gap-2 py-0.5">
          <Chip tone="warn">sync</Chip>
          <button
            className="border-0 bg-transparent p-0 underline"
            style={{ color: "var(--text)" }}
            onClick={() => navigate("project", { id: p.id })}
          >
            {p.name}
          </button>
          <span style={{ color: "var(--muted)" }}>
            {p.ahead > 0 ? `${p.ahead} to push` : ""} {p.behind > 0 ? `${p.behind} to pull` : ""}
          </span>
        </div>
      ))}
      {ci.rows.map((n) => (
        <div key={n.id} className="flex items-center gap-2 py-0.5" data-testid="health-ci">
          <Chip tone="bad">CI</Chip> {n.title}
        </div>
      ))}
      {conflicts.rows.map((n) => (
        <div key={n.id} className="flex items-center gap-2 py-0.5" data-testid="health-conflict">
          <Chip tone="bad">conflict</Chip> {n.title}
        </div>
      ))}
      {hubAttention.map((r) => (
        <div key={r.folder} className="flex items-center gap-2 py-0.5">
          <Chip tone="warn">brain</Chip>
          {r.folder}: {r.state}
        </div>
      ))}
      {validate && !validate.ok && (
        <div className="py-0.5">
          <Chip tone="bad">validate</Chip> {validate.errors.length} error(s): {validate.errors[0]}
        </div>
      )}
      {warnings.map((w) => (
        <div key={w.at + w.message} className="py-0.5">
          <Chip tone="warn">warning</Chip> {w.message}
        </div>
      ))}
    </Panel>
  );
}

/** The morning screen: what waits on you, live agents, health. */
export function Home() {
  return (
    <div className="grid items-start gap-4 p-4 lg:grid-cols-3" data-testid="home">
      <WaitingPanel />
      <div className="grid content-start gap-4">
        <LiveAgentsPanel />
        <TodayPanel />
        <BriefPanel />
      </div>
      <HealthPanel />
    </div>
  );
}
