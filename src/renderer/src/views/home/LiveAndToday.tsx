import { StatusChip } from "../../components/StatusChip";
import { useQuery } from "../../lib/hooks";
import { useUi } from "../../stores/ui";
import { Card, EmptyState, LinkButton, StatusBadge } from "../../ui";

/** Running agents and the ones that need you, plus how many have finished since the owner looked. */
export function LiveAgentsPanel() {
  const navigate = useUi((s) => s.navigate);
  const sessions = useQuery("sessions.list", {}, ["session.status", "session.activity"]);
  const all = sessions.data ?? [];
  const live = all.filter((s) => s.running);
  const idle = all.filter((s) => s.idle);
  const finished = all.filter(
    (s) => !s.running && (s.status === "exited" || s.status === "failed"),
  );
  return (
    <Card title="Live sessions" testId="panel-live">
      {live.length === 0 && finished.length === 0 && (
        <EmptyState title="No sessions running">Start one from a project page.</EmptyState>
      )}
      {live.map((s) => (
        <div key={s.id} className="ui-line" data-testid="live-agent">
          <StatusChip status={s.status} />
          <div className="ui-line-main">
            <LinkButton onClick={() => navigate("agents")}>{s.title ?? s.provider}</LinkButton>
            {s.activity && <div className="ui-line-sub truncate" title={s.activity}>{s.activity}</div>}
          </div>
        </div>
      ))}
      {finished.length > 0 && (
        <div className="ui-line-sub pt-2" data-testid="finished-agents">
          {finished.length} finished {finished.length === 1 ? "session" : "sessions"} to wrap up in
          Sessions.
        </div>
      )}
      {idle.length > 0 && (
        <div className="ui-line-sub pt-2" data-testid="idle-sessions">
          {idle.length} {idle.length === 1 ? "session is" : "sessions are"} past the idle time.{" "}
          <LinkButton onClick={() => navigate("agents")}>Review</LinkButton>
        </div>
      )}
    </Card>
  );
}

const sameDay = (iso: string | null, now: Date): boolean => {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Workflows that ran or are due today. */
export function TodayPanel() {
  const workflows = useQuery("workflows.list", undefined, ["run.done", "workspace.changed"]);
  const now = new Date();
  const mine = (workflows.data ?? []).filter((workflow) => workflow.enabled && workflow.valid);
  const ranToday = mine.filter((a) => sameDay(a.lastFiredAt, now));
  const dueToday = mine.filter((a) => sameDay(a.nextRun, now));
  return (
    <Card title="Today" testId="panel-today">
      {ranToday.length === 0 && dueToday.length === 0 && (
        <EmptyState title="Nothing due today">No workflows are scheduled for today.</EmptyState>
      )}
      {ranToday.map((a) => (
        <div key={`ran-${a.id}`} className="ui-line" data-testid="today-ran">
          <StatusBadge status="done" label="Ran" />
          <div className="ui-line-main">
            {a.name}
            <div className="ui-line-sub num">{clock(a.lastFiredAt as string)}</div>
          </div>
        </div>
      ))}
      {dueToday.map((a) => (
        <div key={`due-${a.id}`} className="ui-line" data-testid="today-due">
          <StatusBadge status="waiting" label="Due" tone="neutral" />
          <div className="ui-line-main">
            {a.name}
            <div className="ui-line-sub num">{clock(a.nextRun as string)}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}
