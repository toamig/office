import { Chip, EmptyState, Panel } from "../../components/ui";
import { timeAgo, useQuery } from "../../lib/hooks";

const tone = (status: string): "neutral" | "good" | "warn" | "bad" =>
  status === "done" || status === "ok" ? "good" : status === "failed" ? "bad" : "neutral";

/** The newest headless agent runs of a project: briefs, captures and task stages. */
export function RecentRuns({ id }: { id: string }) {
  const runs = useQuery("projects.runs", { id }, ["run.done"]);
  return (
    <Panel title="Recent agent runs">
      {runs.data?.length === 0 && <EmptyState>No agent runs for this project yet.</EmptyState>}
      {runs.data?.map((r) => (
        <div key={r.id} className="flex items-center gap-2 py-0.5" data-testid="recent-run">
          <Chip tone={tone(r.status)}>{r.status}</Chip>
          <span>{r.kind}</span>
          <span style={{ color: "var(--muted)" }}>
            {r.provider}
            {r.model ? `, ${r.model}` : ""}, {timeAgo(r.startedAt)}
          </span>
          {r.error && <span style={{ color: "#cf4a4a" }}>{r.error}</span>}
        </div>
      ))}
    </Panel>
  );
}
