import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { WaitingEntry } from "@shared/models";
import { Markdown } from "../components/Markdown";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { useUi } from "../stores/ui";
import { Button, Card, EmptyState, Group, LinkButton, Page, StatusBadge, notifyError } from "../ui";
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
  const done = async (entry: WaitingEntry): Promise<void> => {
    try {
      await office.invoke("vault.tickWaiting", { projectId: entry.projectId, raw: entry.raw });
      waiting.reload();
    } catch (err) {
      notifyError(err, "Could not mark that done", "waiting");
    }
  };
  const groups = groupByProject(waiting.data ?? []);
  return (
    <Card title="Waiting on you" testId="panel-waiting">
      {waiting.data?.length === 0 && (
        <EmptyState title="Nothing is waiting on you">
          Items agents add under &quot;Waiting on you&quot; in the notes show up here, with task
          approvals and review requests.
        </EmptyState>
      )}
      {groups.map(([name, entries]) => (
        <section key={entries[0]?.projectId}>
          <Group>{name}</Group>
          {entries.map((e) => (
            <div key={e.raw} data-testid="waiting-item" className="ui-line">
              <div className="ui-line-main">
                <div>{e.text}</div>
                <div className="ui-line-sub">
                  {e.date}
                  {e.source ? `, ${e.source}` : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("project", { id: e.projectId })}
                data-testid="open-waiting"
              >
                <ExternalLink /> Open
              </Button>
              <Button size="sm" onClick={() => void done(e)} data-testid="done-waiting">
                <Check /> Done
              </Button>
            </div>
          ))}
        </section>
      ))}
      <GatesAndReviews />
    </Card>
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
    } catch (err) {
      notifyError(err, "Could not write the brief", "brief");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={brief.data?.date ? `Morning brief, ${brief.data.date}` : "Morning brief"}
      testId="panel-brief"
      action={
        <Button
          variant="ghost"
          size="sm"
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
          <EmptyState title="No brief yet">
            It is written each morning from what changed the day before.
          </EmptyState>
        )}
        {brief.data?.items.map((item) => (
          <div key={item.projectId} className="mb-2" data-testid="brief-item">
            <Group>{item.projectName}</Group>
            <Markdown>{item.markdown}</Markdown>
          </div>
        ))}
      </div>
    </Card>
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
    <Card title="Health" testId="panel-health">
      {allGood && <StatusBadge status="in-sync" label="Everything is in sync" />}
      {outOfSync.map((p) => (
        <div key={p.id} className="ui-line">
          <StatusBadge status="behind" label="Out of sync" />
          <div className="ui-line-main">
            <LinkButton onClick={() => navigate("project", { id: p.id })}>{p.name}</LinkButton>
            <div className="ui-line-sub">
              {[p.ahead > 0 ? `${p.ahead} to push` : "", p.behind > 0 ? `${p.behind} to pull` : ""]
                .filter(Boolean)
                .join(", ")}
            </div>
          </div>
        </div>
      ))}
      {ci.rows.map((n) => (
        <div key={n.id} className="ui-line" data-testid="health-ci">
          <StatusBadge status="failed" label="Checks failed" />
          <div className="ui-line-main">{n.title}</div>
        </div>
      ))}
      {conflicts.rows.map((n) => (
        <div key={n.id} className="ui-line" data-testid="health-conflict">
          <StatusBadge status="conflict" />
          <div className="ui-line-main">{n.title}</div>
        </div>
      ))}
      {hubAttention.map((r) => (
        <div key={r.folder} className="ui-line">
          <StatusBadge status="behind" label="Notes need attention" />
          <div className="ui-line-main">
            {r.folder}
            <div className="ui-line-sub">{r.state}</div>
          </div>
        </div>
      ))}
      {validate && !validate.ok && (
        <div className="ui-line">
          <StatusBadge status="failed" label="Notes check failed" />
          <div className="ui-line-main">
            {validate.errors.length} {validate.errors.length === 1 ? "error" : "errors"}
            <div className="ui-line-sub">{validate.errors[0]}</div>
          </div>
        </div>
      )}
      {warnings.map((w) => (
        <div key={w.at + w.message} className="ui-line">
          <StatusBadge status="behind" label="Warning" />
          <div className="ui-line-main">{w.message}</div>
        </div>
      ))}
    </Card>
  );
}

/** The morning screen: what waits on you, live agents, health. */
export function Home() {
  return (
    <Page title="Home" testId="home">
      <div className="home-grid">
        <WaitingPanel />
        <LiveAgentsPanel />
        <TodayPanel />
        <BriefPanel />
        <HealthPanel />
      </div>
    </Page>
  );
}
