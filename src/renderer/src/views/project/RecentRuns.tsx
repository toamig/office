import { useQuery } from "../../lib/hooks";
import { Card, EmptyState, StatusBadge, Time } from "../../ui";

/** The newest headless agent runs of a project: briefs, captures and task stages. */
export function RecentRuns({ id }: { id: string }) {
  const runs = useQuery("projects.runs", { id }, ["run.done"]);
  return (
    <Card title="Recent agent runs" testId="panel-runs">
      {runs.data?.length === 0 && (
        <EmptyState title="No agent runs yet">
          Briefs, captures and task stages show here.
        </EmptyState>
      )}
      {runs.data?.map((r) => (
        <div key={r.id} className="ui-line" data-testid="recent-run">
          <StatusBadge status={r.status === "ok" ? "done" : r.status} />
          <div className="ui-line-main">
            {r.kind}
            <div className="ui-line-sub">
              {r.provider}
              {r.model ? `, ${r.model}` : ""}, <Time iso={r.startedAt} />
            </div>
            {r.error && <div className="ui-line-sub ui-bad">{r.error}</div>}
          </div>
        </div>
      ))}
    </Card>
  );
}
