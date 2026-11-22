import type { BackgroundRun } from "@shared/models";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Button, StatusBadge, Time, notifyError } from "../ui";

export function useBackgroundRuns(includeStopped = false) {
  return useQuery("runs.background", { includeStopped }, ["run.started", "run.stopping", "run.done"]).data ?? [];
}

export function BackgroundRuns({ runs }: { runs: BackgroundRun[] }) {
  return <>{runs.map((run) => <div key={run.id} className="ui-line" data-testid="background-run">
    <StatusBadge status={run.status} />
    <div className="ui-line-main min-w-0">
      <div className="truncate" title={run.title}>{run.title}</div>
      {run.endedAt && <div className="ui-line-sub"><Time iso={run.endedAt} /></div>}
    </div>
    {run.status !== "stopped" && <Button size="sm" variant="ghost" disabled={run.status === "stopping"}
      aria-label={`Stop ${run.title}`} onClick={() => void office.invoke("runs.stop", { id: run.id }).catch((error: unknown) => {
        notifyError(error, "Could not stop the run", run.id);
      })}>Stop</Button>}
  </div>)}</>;
}
