import { useState } from "react";
import { Markdown } from "../components/Markdown";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { useUi, type ViewId } from "../stores/ui";
import { Button, Card, EmptyState, Group, LinkButton, Page, StatusBadge, notifyError } from "../ui";
import { describeValidate } from "@shared/health";
import { FixButton } from "../components/Fix";
import { RepoItem } from "../components/HealthItems";
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

/** The brief: three to five plain lines at the top of Home, each leading to its place, and the facts behind them. */
function BriefPanel() {
  const navigate = useUi((s) => s.navigate);
  const brief = useQuery("brief.latest", undefined, ["brief.changed"]);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const write = async (): Promise<void> => {
    setBusy(true);
    try {
      await office.invoke("brief.run");
      brief.reload();
    } catch (err) {
      notifyError(err, "Could not write the brief", "brief", {
        label: "Try again",
        run: () => void write(),
      });
    } finally {
      setBusy(false);
    }
  };
  const lines = brief.data?.lines ?? [];
  const items = brief.data?.items ?? [];
  return (
    <Card
      title={brief.data?.date ? `Brief, ${brief.data.date}` : "Brief"}
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
        {brief.data && brief.data.date === null && (
          <EmptyState title="No brief yet">
            It is written each morning: what changed, what needs you and what to do next.
          </EmptyState>
        )}
        {lines.map((line, i) => (
          <div key={`${i}-${line.text}`} className="ui-line" data-testid="brief-line">
            <div className="ui-line-main">
              <LinkButton
                onClick={() => navigate(line.link.view as ViewId, line.link.params ?? {})}
              >
                {line.text}
              </LinkButton>
            </div>
          </div>
        ))}
        {items.length > 0 && (
          <div className="pt-2">
            <LinkButton onClick={() => setDetails(!details)} data-testid="brief-details">
              {details ? "Hide details" : "Show details"}
            </LinkButton>
          </div>
        )}
        {details &&
          items.map((item) => (
            <div key={item.projectId} className="mt-2" data-testid="brief-item">
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
    <Page title="Home" subtitle="What needs you, what is running and what changed." testId="home">
      <BriefPanel />
      <div className="home-grid">
        <NeedsYouPanel />
        <LiveAgentsPanel />
        <TodayPanel />
        <HealthPanel />
      </div>
    </Page>
  );
}
