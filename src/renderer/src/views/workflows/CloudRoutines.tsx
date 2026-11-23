import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { describeNext } from "@shared/schedule";
import { cloudSendToLabels, durationWords, type CloudRoutineView, type CloudSendTo } from "@shared/cloud";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { Banner, Button, Card, Dialog, Dropdown, ListRow, StatusBadge, Time, notifyError } from "../../ui";

const RUN_BADGE = {
  succeeded: { status: "done", label: "Succeeded" },
  failed: { status: "failed", label: "Failed" },
  running: { status: "running", label: "Running" },
} as const;

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

interface RowActions { run: (routine: CloudRoutineView) => void; toggle: (routine: CloudRoutineView) => void; sendTo: (routine: CloudRoutineView, to: CloudSendTo) => void }

function RoutineRow({ routine, actions }: { routine: CloudRoutineView; actions?: RowActions }) {
  const last = routine.lastRun;
  const run = last ? RUN_BADGE[last.state] : null;
  const took = durationWords(last?.seconds ?? null);
  return <ListRow testId={`cloud-routine-${routine.id}`} trailing={<div className="flex flex-wrap items-start justify-end gap-2">
    {actions && !routine.finished && <>
      <Button size="sm" onClick={() => actions.run(routine)}>Run now</Button>
      <Button size="sm" onClick={() => actions.toggle(routine)}>{routine.enabled ? "Pause" : "Resume"}</Button>
    </>}
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
    {actions && !routine.finished && <label className="flex flex-wrap items-center gap-2 pt-1">
      <span className="ui-muted">Send results to</span>
      <Dropdown aria-label={`Send results of ${routine.name} to`} value={routine.sendTo}
        onChange={(event) => actions.sendTo(routine, event.target.value as CloudSendTo)}>
        {(Object.keys(cloudSendToLabels) as CloudSendTo[]).map((key) => <option key={key} value={key}>{cloudSendToLabels[key]}</option>)}
      </Dropdown>
    </label>}
    <RoutineDetails routine={routine} />
  </ListRow>;
}

/** Claude Code's cloud routines, read through the claude program, each with its last run. */
export function CloudRoutines() {
  const cloud = useQuery("cloud.state", undefined, ["cloud.changed"]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ routine: CloudRoutineView; kind: "run" | "toggle" }>();
  const [acting, setActing] = useState(false);
  const state = cloud.data;
  if (!state || (state.status === "loading" && state.routines.length === 0 && !state.refreshing)) return null;

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try { await office.invoke("cloud.refresh"); }
    catch (error) { notifyError(error, "Could not read the cloud routines", "cloud"); }
    finally { setBusy(false); }
  };
  const working = busy || state.refreshing;
  const act = async (): Promise<void> => {
    if (!confirm) return;
    setActing(true);
    try {
      const { routine, kind } = confirm;
      if (kind === "run") await office.invoke("cloud.run", { id: routine.id, confirmed: true });
      else await office.invoke("cloud.setEnabled", { id: routine.id, enabled: !routine.enabled, confirmed: true });
      setConfirm(undefined);
    } catch (error) {
      notifyError(error, confirm.kind === "run" ? "Could not run the routine" : "Could not change the routine", confirm.routine.name);
    } finally {
      setActing(false);
    }
  };
  const actions: RowActions = {
    run: (routine) => setConfirm({ routine, kind: "run" }),
    toggle: (routine) => setConfirm({ routine, kind: "toggle" }),
    sendTo: (routine, to) => {
      office.invoke("cloud.setSendTo", { id: routine.id, sendTo: to })
        .catch((error: unknown) => notifyError(error, "Could not save where results go", routine.name));
    },
  };
  const question = confirm
    ? confirm.kind === "run" ? `Run ${confirm.routine.name} now in the cloud?`
      : confirm.routine.enabled ? `Pause ${confirm.routine.name}? It will not run on its schedule until you resume it.`
      : `Resume ${confirm.routine.name}? It will run on its schedule again.`
    : "";
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
        {open.map((routine) => <RoutineRow key={routine.id} routine={routine} actions={actions} />)}
      </div>
      {done.length > 0 && <details className="pt-2">
        <summary className="ui-muted cursor-pointer">Finished ({done.length})</summary>
        <div className="grid gap-1 pt-2">
          {done.map((routine) => <RoutineRow key={routine.id} routine={routine} />)}
        </div>
      </details>}
      {confirm && <Dialog title={confirm.kind === "run" ? "Run now" : confirm.routine.enabled ? "Pause routine" : "Resume routine"}
        onClose={() => { if (!acting) setConfirm(undefined); }} footer={<>
          <Button disabled={acting} onClick={() => setConfirm(undefined)}>Cancel</Button>
          <Button variant="primary" disabled={acting} onClick={() => void act()}>
            {confirm.kind === "run" ? "Run now" : confirm.routine.enabled ? "Pause" : "Resume"}
          </Button>
        </>}>
        <p>{question}</p>
      </Dialog>}
    </Card>
  );
}
