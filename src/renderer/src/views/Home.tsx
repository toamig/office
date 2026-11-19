import { useState } from "react";
import { Markdown } from "../components/Markdown";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { useUi } from "../stores/ui";
import { Button, Card, EmptyState, Group, LinkButton, Page, StatusBadge, notifyError } from "../ui";
import { PendingGroups } from "../components/PendingList";
import { PermissionRequests } from "../components/PermissionRequests";
import { usePending } from "../lib/pending";
import { LiveAgentsPanel, TodayPanel } from "./home/LiveAndToday";

/** Home shows the first few; Needs you shows them all. */
const SHOWN = 8;

function NeedsYouPanel() {
  const { items } = usePending();
  const navigate = useUi((s) => s.navigate);
  const rows = items.filter((i) => i.kind !== "permission");
  return (
    <Card title="Needs you" testId="panel-waiting">
      <PermissionRequests compact />
      {rows.length === 0 && items.length === 0 && (
        <EmptyState title="Nothing needs you">
          Approvals, agents that need you, conflicts, failed checks and review requests show here
          until you have dealt with them.
        </EmptyState>
      )}
      <PendingGroups items={rows.slice(0, SHOWN)} />
      {rows.length > SHOWN && (
        <Button onClick={() => navigate("inbox")} data-testid="needs-you-more">
          Show all {rows.length}
        </Button>
      )}
    </Card>
  );
}

function BriefPanel() {
  const brief = useQuery("brief.latest", undefined, ["brief.changed"]);
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
  const hubAttention = (health.data?.repos ?? []).filter((r) => r.attention);
  const validate = health.data?.validate;
  const warnings = health.data?.warnings ?? [];
  const allGood =
    outOfSync.length === 0 &&
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
    <Page title="Home" subtitle="What needs you, what is running and what changed." testId="home">
      <div className="home-grid">
        <NeedsYouPanel />
        <LiveAgentsPanel />
        <TodayPanel />
        <BriefPanel />
        <HealthPanel />
      </div>
    </Page>
  );
}
