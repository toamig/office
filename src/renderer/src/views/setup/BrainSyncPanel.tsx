import { useEffect, useState } from "react";
import type { BrainSyncState } from "@shared/models";
import { office } from "../../lib/ipc";
import { Card, StatusBadge } from "../../ui";

const when = (value: string | null): string => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : value ?? "Never";
};

/** The Windows task that keeps the Brain in step every 15 minutes, with or without Office. Office only shows it. */
export function BrainSyncPanel() {
  const [state, setState] = useState<BrainSyncState | null>(null);
  useEffect(() => { void office.invoke("setup.brainSync").then(setState).catch(() => setState(null)); }, []);
  return (
    <Card title="Brain auto-sync" testId="panel-brain-sync">
      <p className="ui-muted pb-2">
        A Windows task pulls the Brain and pushes saved notes every 15 minutes, even when Office is closed. Office only shows its state.
      </p>
      {!state ? <p className="ui-muted">Checking</p> : state.state === "unsupported"
        ? <p className="ui-muted">This computer has no Windows task for it.</p>
        : state.state === "missing"
          ? <StatusBadge status="not-set-up" tone="attention" label="Not set up" />
          : <dl className="ui-dl">
            <dt>State</dt>
            <dd><StatusBadge status={state.state} tone={state.state === "on" ? "success" : "attention"} label={state.state === "on" ? "On" : "Off"} /></dd>
            <dt>Last run</dt>
            <dd>{when(state.last)}{state.lastResultOk === false ? " (it reported a problem)" : ""}</dd>
            <dt>Next run</dt>
            <dd>{when(state.next)}</dd>
          </dl>}
    </Card>
  );
}
