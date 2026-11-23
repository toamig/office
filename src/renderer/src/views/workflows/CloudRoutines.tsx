import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { describeNext } from "@shared/schedule";
import type { CloudRoutineView } from "@shared/cloud";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { Banner, Button, Card, ListRow, StatusBadge, Time, notifyError } from "../../ui";

const RUN_BADGE = {
  succeeded: { status: "done", label: "Succeeded" },
  failed: { status: "failed", label: "Failed" },
  running: { status: "running", label: "Running" },
} as const;

/** "3 min", "1 h 5 min", "40 s": how long a run took. */
export function lengthOf(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function RoutineDetails({ routine }: { routine: CloudRoutineView }) {
  const { details } = routine;
  return <details className="pt-1">
    <summary className="ui-muted cursor-pointer">Details</summary>
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 pt-2">
      {details.model && <><dt className="ui-muted">Model</dt><dd className="break-words">{details.model}</dd></>}
      {details.repositories.length > 0 && <><dt className="ui-muted">Repositories</dt>
        <dd className="break-words">{details.repositories.join(", ")}</dd></>}
      {details.connectors.length > 0 && <><dt className="ui-muted">Connectors</dt>
        <dd className="break-words">{details.connectors.join(", ")}</dd></>}
      {details.cron && <><dt className="ui-muted">Schedule in UTC</dt><dd className="break-words"><code>{details.cron}</code></dd></>}
      <dt className="ui-muted">Routine id</dt><dd className="break-all"><code>{details.id}</code></dd>
      {details.prompt && <><dt className="ui-muted">Prompt</dt>
        <dd className="text-selectable max-h-48 overflow-auto whitespace-pre-wrap break-words">{details.prompt}</dd></>}
      {routine.lastRun?.failure && <><dt className="ui-muted">Failure reason</dt>
        <dd className="text-selectable break-words">{routine.lastRun.failure}</dd></>}
    </dl>
    <p className="ui-muted pt-2">Change a routine's prompt, repositories or model in Claude.</p>
  </details>;
}

function RoutineRow({ routine, actions }: { routine: CloudRoutineView; actions?: React.ReactNode }) {
  const last = routine.lastRun;
  const run = last ? RUN_BADGE[last.state] : null;
  const took = lengthOf(last?.seconds ?? null);
  return <ListRow testId={`cloud-routine-${routine.id}`} trailing={<div className="flex flex-wrap items-start justify-end gap-2">
    {actions}
    <Button size="sm" onClick={() => window.open(routine.link, "_blank", "noopener")}>Open in Claude</Button>
  </div>}>
    <p className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words">{routine.name}</span>
      {!routine.finished && <StatusBadge status={routine.enabled ? "done" : "stopped"} label={routine.enabled ? "On" : "Off"} />}
    </p>
    <p className="ui-muted">{[
      routine.schedule ?? (routine.finished ? "Ran once" : "Runs once"),
      routine.nextRun ? `Next ${describeNext(new Date(routine.nextRun), new Date())}` : null,
      routine.projectName,
    ].filter(Boolean).join(" · ")}</p>
    {last && run && <p className="flex flex-wrap items-center gap-2 pt-1">
      <StatusBadge status={run.status} label={run.label} />
      {last.finishedAt ?? last.firedAt ? <span className="ui-muted"><Time iso={last.finishedAt ?? last.firedAt} />{took ? ` · ${took}` : ""}</span> : null}
    </p>}
    <RoutineDetails routine={routine} />
  </ListRow>;
}

/** Claude Code's cloud routines, read through the claude program, each with its last run. */
export function CloudRoutines({ actions }: { actions?: (routine: CloudRoutineView) => React.ReactNode }) {
  const cloud = useQuery("cloud.state", undefined, ["cloud.changed"]);
  const [busy, setBusy] = useState(false);
  const state = cloud.data;
  if (!state || (state.status === "loading" && state.routines.length === 0 && !state.refreshing)) return null;

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try { await office.invoke("cloud.refresh"); }
    catch (error) { notifyError(error, "Could not read the cloud routines", "cloud"); }
    finally { setBusy(false); }
  };
  const working = busy || state.refreshing;
  const open = state.routines.filter((routine) => !routine.finished);
  const done = state.routines.filter((routine) => routine.finished);

  return (
    <Card title="Cloud routines" testId="cloud-routines" action={
      <Button size="sm" disabled={working} onClick={() => void refresh()}><RefreshCw className={working ? "ui-spin" : undefined} /> {working ? "Reading" : "Refresh"}</Button>
    }>
      <p className="ui-muted pb-2">
        These run in Claude's cloud. Office reads them through Claude Code with your own sign-in and shows each run's result.
        {state.refreshedAt ? <> Read <Time iso={state.refreshedAt} />.</> : null}
      </p>
      {state.status === "unavailable" && <Banner tone="attention">
        <p>{state.message}</p>
        {state.reason && <details><summary className="cursor-pointer">Details</summary>
          <div className="text-selectable whitespace-pre-wrap break-words pt-1">{state.reason}</div></details>}
      </Banner>}
      {state.status === "ok" && state.routines.length === 0 && <p className="ui-muted">No cloud routines found.</p>}
      <div className="grid gap-1">
        {open.map((routine) => <RoutineRow key={routine.id} routine={routine} actions={actions?.(routine)} />)}
      </div>
      {done.length > 0 && <details className="pt-2">
        <summary className="ui-muted cursor-pointer">Finished ({done.length})</summary>
        <div className="grid gap-1 pt-2">
          {done.map((routine) => <RoutineRow key={routine.id} routine={routine} />)}
        </div>
      </details>}
    </Card>
  );
}
