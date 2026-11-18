import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { WaitingEntry } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../components/ui";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";

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
          Nothing is waiting on you. Items agents add under &quot;Waiting on you&quot; show up here.
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
    </Panel>
  );
}

function AgentsPanel() {
  return (
    <Panel title="Live agents">
      <EmptyState>No agents running. Start one from a project page.</EmptyState>
    </Panel>
  );
}

function HealthPanel() {
  const navigate = useUi((s) => s.navigate);
  const projects = useQuery("projects.list", undefined, ["project.status"]);
  const health = useQuery("vault.health", undefined, ["vault.changed", "notification.new"]);
  const outOfSync = (projects.data ?? []).filter(
    (p) => !p.archived && (p.ahead > 0 || p.behind > 0),
  );
  const hubAttention = (health.data?.repos ?? []).filter((r) => r.attention);
  const validate = health.data?.validate;
  const warnings = health.data?.warnings ?? [];
  const allGood =
    outOfSync.length === 0 &&
    hubAttention.length === 0 &&
    validate?.ok !== false &&
    warnings.length === 0;
  return (
    <Panel title="Health">
      <div className="mb-2 text-[12px]" style={{ color: "var(--muted)" }}>
        Morning brief: it appears here once agents are running (coming with the Workbench).
      </div>
      {allGood && <Chip tone="good">Everything is in sync</Chip>}
      {outOfSync.map((p) => (
        <div key={p.id} className="flex items-center gap-2 py-0.5">
          <Chip tone="warn">sync</Chip>
          <button
            className="cursor-pointer border-0 bg-transparent p-0 underline"
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
    <div className="grid gap-4 p-4 lg:grid-cols-3" data-testid="home">
      <WaitingPanel />
      <AgentsPanel />
      <HealthPanel />
    </div>
  );
}
