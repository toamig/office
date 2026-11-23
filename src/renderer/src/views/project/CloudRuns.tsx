import { durationWords } from "@shared/cloud";
import { useQuery } from "../../lib/hooks";
import { Button, Card, StatusBadge, Time } from "../../ui";

/** The cloud routine runs reported for a project, newest first. Nothing shows until one has been reported. */
export function CloudRuns({ id }: { id: string }) {
  const runs = useQuery("cloud.projectRuns", { id }, ["cloud.changed"]);
  if (!runs.data || runs.data.length === 0) return null;
  return (
    <Card title="Cloud routine runs" testId="panel-cloud-runs">
      {runs.data.map((run) => (
        <div key={run.sessionId} className="ui-line" data-testid="cloud-run">
          <StatusBadge status={run.state === "failed" ? "failed" : "done"} label={run.state === "failed" ? "Failed" : "Succeeded"} />
          <div className="ui-line-main">
            <span className="break-words">{run.routine}</span>
            <div className="ui-line-sub">
              <Time iso={run.finishedAt} />{durationWords(run.seconds) ? ` · ${durationWords(run.seconds)}` : ""}
            </div>
          </div>
          {run.url && <Button size="sm" onClick={() => window.open(run.url!, "_blank", "noopener")}>Open in Claude</Button>}
        </div>
      ))}
    </Card>
  );
}
