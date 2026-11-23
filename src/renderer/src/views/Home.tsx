import { useState } from "react";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { useUi } from "../stores/ui";
import { Button, Card, EmptyState, LinkButton, Page, StatusBadge, notifyError } from "../ui";
import { describeValidate } from "@shared/health";
import { FixButton } from "../components/Fix";
import { RepoItem } from "../components/HealthItems";
import { PendingGroups } from "../components/PendingList";
import { PermissionRequests } from "../components/PermissionRequests";
import { usePending } from "../lib/pending";
import { LiveAgentsPanel, TodayPanel } from "./home/LiveAndToday";
import { RequestComposer } from "./home/RequestComposer";
import { WorthALook } from "./home/WorthALook";
import { BriefPanel } from "./home/BriefCards";

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

function HealthPanel() {
  const navigate = useUi((s) => s.navigate);
  const projects = useQuery("projects.list", undefined, ["project.status"]);
  const health = useQuery("vault.health", undefined, ["vault.health"]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const outOfSync = (projects.data ?? []).filter(
    (p) => !p.archived && (p.ahead > 0 || p.behind > 0),
  );
  const hubAttention = (health.data?.repos ?? []).filter((r) => r.attention);
  const validate = health.data?.validate;
  const problems = validate?.problems ?? [];
  const warnings = health.data?.warnings ?? [];
  const allGood =
    outOfSync.length === 0 &&
    hubAttention.length === 0 &&
    validate?.ok !== false &&
    problems.length === 0 &&
    warnings.length === 0;
  const sync = async (id: string, name: string): Promise<void> => {
    setSyncing(id);
    try {
      await office.invoke("git.syncProject", { id });
      projects.reload();
    } catch (err) {
      notifyError(err, `Could not sync ${name}`, `sync-${id}`);
    } finally {
      setSyncing(null);
    }
  };
  return (
    <Card title="Health" testId="panel-health">
      {allGood && <StatusBadge status="in-sync" label="Everything is in sync" />}
      {outOfSync.map((p) => (
        <div key={p.id} className="ui-line" data-testid="health-out-of-sync">
          <StatusBadge status="behind" label="Out of sync" />
          <div className="ui-line-main">
            <LinkButton onClick={() => navigate("project", { id: p.id })}>{p.name}</LinkButton>
            <div className="ui-line-sub">
              {[p.ahead > 0 ? `${p.ahead} to push` : "", p.behind > 0 ? `${p.behind} to pull` : ""]
                .filter(Boolean)
                .join(", ")}
            </div>
          </div>
          <Button
            size="sm"
            disabled={syncing === p.id}
            onClick={() => void sync(p.id, p.name)}
            data-testid="health-sync"
          >
            {syncing === p.id ? "Syncing..." : "Sync"}
          </Button>
        </div>
      ))}
      {hubAttention.map((r) => (
        <RepoItem key={r.folder} repo={r} />
      ))}
      {validate?.ran && (!validate.ok || problems.length > 0) && (
        <div className="ui-line" data-testid="health-summary">
          <StatusBadge
            status={validate.ok ? "passed" : "failed"}
            label={validate.ok ? "Checks pass" : "Checks fail"}
          />
          <span className="ui-muted ui-line-main">{describeValidate(validate)}</span>
          <LinkButton onClick={() => navigate("brain")}>Open Brain</LinkButton>
        </div>
      )}
      {warnings.map((w) => (
        <div key={w.at + w.message} className="ui-line" data-testid="health-warning">
          <StatusBadge status="behind" label="Warning" />
          <div className="ui-line-main">{w.message}</div>
          <FixButton subject={{ type: "warning", message: w.message }} />
        </div>
      ))}
    </Card>
  );
}

/** The morning screen: what waits on you, live agents, health. */
export function Home() {
  return (
    <Page title="Home" subtitle="What needs you, what is running and what changed." testId="home"
      primary={<Button onClick={() => useUi.getState().navigate("usage")} data-testid="home-usage">Usage</Button>}>
      <RequestComposer />
      <div className="home-brief-grid">
        <BriefPanel />
        <WorthALook />
      </div>
      <div className="home-grid">
        <NeedsYouPanel />
        <LiveAgentsPanel />
        <TodayPanel />
        <HealthPanel />
      </div>
    </Page>
  );
}
