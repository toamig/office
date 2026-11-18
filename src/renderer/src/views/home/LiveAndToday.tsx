import type { AutomationView } from "@shared/models";
import { Chip, EmptyState, Panel } from "../../components/ui";
import { useQuery } from "../../lib/hooks";
import { useUi } from "../../stores/ui";
import { StatusChip } from "../../components/StatusChip";

/** Running agents and the ones that need you, plus how many have finished since the owner looked. */
export function LiveAgentsPanel() {
  const navigate = useUi((s) => s.navigate);
  const sessions = useQuery("sessions.list", {}, ["session.status"]);
  const all = sessions.data ?? [];
  const live = all.filter((s) => s.running);
  const finished = all.filter(
    (s) => !s.running && (s.status === "exited" || s.status === "failed"),
  );
  return (
    <Panel title="Live agents">
      {live.length === 0 && finished.length === 0 && (
        <EmptyState>No agents running. Start one from a project page.</EmptyState>
      )}
      {live.map((s) => (
        <div key={s.id} className="flex items-center gap-2 py-0.5" data-testid="live-agent">
          <StatusChip status={s.status} />
          <button
            className="border-0 bg-transparent p-0 text-left underline"
            style={{ color: "var(--text)" }}
            onClick={() => navigate("agents")}
          >
            {s.title ?? s.provider}
          </button>
        </div>
      ))}
      {finished.length > 0 && (
        <div
          className="pt-1 text-[12px]"
          style={{ color: "var(--muted)" }}
          data-testid="finished-agents"
        >
          {finished.length} finished {finished.length === 1 ? "session" : "sessions"} to wrap up in
          Agents.
        </div>
      )}
    </Panel>
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

/** Automations that ran or are due today. */
export function TodayPanel() {
  const automations = useQuery("automations.list", undefined, ["run.done"]);
  const now = new Date();
  const mine = (automations.data ?? []).filter((a: AutomationView) => a.enabled && a.valid);
  const ranToday = mine.filter((a) => sameDay(a.lastFiredAt, now));
  const dueToday = mine.filter((a) => sameDay(a.nextRun, now));
  return (
    <Panel title="Today">
      {ranToday.length === 0 && dueToday.length === 0 && (
        <EmptyState>No automations are due today.</EmptyState>
      )}
      {ranToday.map((a) => (
        <div key={`ran-${a.id}`} className="py-0.5" data-testid="today-ran">
          <Chip tone="good">ran</Chip> {clock(a.lastFiredAt as string)} {a.project}:{" "}
          {a.prompt.slice(0, 60)}
        </div>
      ))}
      {dueToday.map((a) => (
        <div key={`due-${a.id}`} className="py-0.5" data-testid="today-due">
          <Chip>due</Chip> {clock(a.nextRun as string)} {a.project}: {a.prompt.slice(0, 60)}
        </div>
      ))}
    </Panel>
  );
}
