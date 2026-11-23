import { useState } from "react";
import { BRIEF_RANGE_LABELS, BriefRange, type BriefCard, type BriefLine, type BriefLink, type BriefNext } from "@shared/brief";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi, type ViewId } from "../../stores/ui";
import { Button, Card, Dropdown, EmptyState, Group, LinkButton, notifyError } from "../../ui";
import { SavedNotes } from "./SavedNotes";

/** What each next step's button says. */
const ACTION_LABELS: Record<BriefNext["action"]["kind"], string> = { continue: "Continue", start: "Start a session", open: "Open" };

export function useBriefActions() {
  const navigate = useUi((state) => state.navigate);
  const go = (link: BriefLink): void => navigate(link.view as ViewId, link.params ?? {});
  const run = async (project: string, next: BriefNext): Promise<void> => {
    try {
      if (next.action.kind === "continue") navigate("agents", { session: next.action.sessionId });
      else if (next.action.kind === "open") go(next.action.link);
      else {
        const started = await office.invoke("sessions.start", { projectId: next.action.projectId, prompt: next.action.brief, title: next.action.brief.slice(0, 80) });
        navigate("agents", { session: started.id });
      }
    } catch (error) {
      notifyError(error, "Could not do that", `brief-${project}`);
    }
  };
  return { go, run };
}

function Lines({ title, lines, go }: { title: string; lines: BriefLine[]; go: (link: BriefLink) => void }) {
  if (lines.length === 0) return null;
  return (
    <div className="grid gap-0.5">
      <span className="ui-label">{title}</span>
      <ul className="m-0 grid list-none gap-1 p-0">
        {lines.map((line, at) => (
          <li key={`${at}-${line.text}`} data-testid="brief-line"><LinkButton onClick={() => go(line.link)}>{line.text}</LinkButton></li>
        ))}
      </ul>
    </div>
  );
}

/** One project's catch-up: what was done, where it stands, and what to do next, each with the button that does it. */
export function BriefCardView({ card }: { card: BriefCard }) {
  const { go, run } = useBriefActions();
  return (
    <section className="grid gap-3 border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0" data-testid="brief-card" aria-label={card.projectName}>
      <Group>{card.projectName}</Group>
      <Lines title="Done" lines={card.done} go={go} />
      <Lines title="Where it stands" lines={card.stands} go={go} />
      {card.next.length > 0 && (
        <div className="grid gap-1">
          <span className="ui-label">Next</span>
          {card.next.map((next, at) => (
            <div key={`${at}-${next.text}`} className="flex flex-wrap items-center justify-between gap-2" data-testid="brief-next">
              <span className="min-w-0 flex-1">{next.text}</span>
              <Button size="sm" onClick={() => void run(card.projectId, next)}>{ACTION_LABELS[next.action.kind]}</Button>
            </div>
          ))}
        </div>
      )}
      {card.unknown && <p className="ui-muted m-0" data-testid="brief-unknown">{card.unknown}</p>}
    </section>
  );
}

/** The brief at the top of Home: where you left off, a card for each project, and what needs you today. */
export function BriefPanel() {
  const { go } = useBriefActions();
  const brief = useQuery("brief.latest", undefined, ["brief.changed", "settings.changed"]);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<BriefRange | null>(null);
  const shown = range ?? brief.data?.range ?? "since-last";
  const write = async (next: BriefRange): Promise<void> => {
    setBusy(true);
    setRange(next);
    try {
      await office.invoke("brief.run", { range: next });
      brief.reload();
    } catch (err) {
      notifyError(err, "Could not write the brief", "brief", { label: "Try again", run: () => void write(next) });
    } finally {
      setBusy(false);
    }
  };
  const view = brief.data;
  return (
    <Card
      title={view?.date ? `Where you left off, ${view.date}` : "Where you left off"}
      testId="panel-brief"
      action={
        <div className="flex items-center gap-2">
          <Dropdown aria-label="Range of the brief" value={shown} onChange={(event) => void write(BriefRange.parse(event.target.value))} disabled={busy} data-testid="brief-range">
            {BriefRange.options.map((option) => <option key={option} value={option}>{BRIEF_RANGE_LABELS[option]}</option>)}
          </Dropdown>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void write(shown)} data-testid="brief-run">{busy ? "Writing..." : "Write it now"}</Button>
        </div>
      }
    >
      <div className="grid gap-3" data-testid="brief">
        {view && view.needsYou.length > 0 && (
          <div className="grid gap-0.5" data-testid="brief-needs-you">
            <span className="ui-label">Needs you today</span>
            <ul className="m-0 grid list-none gap-1 p-0">
              {view.needsYou.map((item, at) => <li key={`${at}-${item.text}`}><LinkButton onClick={() => go(item.link)}>{item.text}</LinkButton></li>)}
            </ul>
          </div>
        )}
        {view && view.date === null && (
          <EmptyState title="No brief yet">It says where you left off: what was done, where each project stands, and what to do next.</EmptyState>
        )}
        {view && view.date !== null && view.cards.length === 0 && <p className="ui-muted m-0">Nothing was recorded since {view.since ? new Date(view.since).toLocaleDateString() : "last time"}.</p>}
        {view?.cards.map((card) => <BriefCardView key={card.projectId} card={card} />)}
        <SavedNotes />
      </div>
    </Card>
  );
}
