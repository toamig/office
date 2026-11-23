import { useState, type ReactNode } from "react";
import type { AppSettingsPatch } from "@shared/models";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Card, Group, Input, notifyError } from "../../ui";

function Job({ label, enabled, toggle, children, disabled }: {
  label: string; enabled: boolean; toggle: (on: boolean) => void; children?: ReactNode; disabled?: boolean;
}) {
  return (
    <div className="ui-line flex-wrap">
      <label className="flex min-w-36 items-center gap-2 font-medium">
        <input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => toggle(event.target.checked)} />
        {label}
      </label>
      {children}
    </div>
  );
}

function ModelField({ job, model, save, fallback = "Cheapest available" }: { job: string; model: string; save: (value: string) => void; fallback?: string }) {
  return <Input key={model} hideLabel label={`${job} model`} defaultValue={model} placeholder={fallback}
    maxLength={120} onBlur={(event) => { if (model !== event.target.value.trim()) save(event.target.value.trim()); }} />;
}

export function BackgroundAiPanel() {
  const settings = useQuery("settings.get", undefined, ["settings.changed", "workspace.changed"]);
  const workflows = useQuery("workflows.list", undefined, ["workspace.changed"]);
  const [busy, setBusy] = useState<string>();
  const s = settings.data;
  const set = async (patch: AppSettingsPatch): Promise<void> => {
    try {
      await office.invoke("settings.set", patch);
      settings.reload();
    } catch (error) { notifyError(error, "Could not change Background AI", "background-ai"); }
  };
  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    setBusy(id);
    try {
      await office.invoke("workflows.setEnabled", { id, enabled });
      workflows.reload();
    } catch (error) { notifyError(error, "Could not change the workflow switch", id); }
    finally { setBusy(undefined); }
  };
  return (
    <Card title="Background AI" testId="panel-background-ai">
      {s && (
        <>
          <Job label="Morning brief" enabled={s.briefEnabled} toggle={(briefEnabled) => void set({ briefEnabled })}>
            <ModelField job="Morning brief" model={s.briefModel} fallback="Sonnet" save={(briefModel) => void set({ briefModel })} />
            <Input type="time" hideLabel label="Morning brief time" value={s.briefTime}
              onChange={(event) => { if (event.target.value) void set({ briefTime: event.target.value }); }} />
          </Job>
          <Job label="Recorder" enabled={s.recorderEnabled} toggle={(recorderEnabled) => void set({ recorderEnabled })}>
            <ModelField job="Recorder" model={s.recorderModel} save={(recorderModel) => void set({ recorderModel })} />
            <Input type="number" className="w-20" min={1} max={120} key={s.recorderIdleMinutes} defaultValue={s.recorderIdleMinutes}
              hideLabel label="Recorder idle minutes" onBlur={(event) => {
                const recorderIdleMinutes = Number(event.target.value);
                if (event.target.validity.valid && recorderIdleMinutes !== s.recorderIdleMinutes)
                  void set({ recorderIdleMinutes });
              }} />
            <span className="ui-line-sub">idle minutes or at wrap-up</span>
          </Job>
          <Job label="Learning" enabled={s.learningEnabled} toggle={(learningEnabled) => void set({ learningEnabled })}>
            <span className="ui-line-sub">Uses the recorder model and schedule</span>
          </Job>
          <Job label="Request router" enabled={s.requestRouterEnabled} toggle={(requestRouterEnabled) => void set({ requestRouterEnabled })}>
            <ModelField job="Request router" model={s.requestRouterModel} save={(requestRouterModel) => void set({ requestRouterModel })} />
            <span className="ui-line-sub">When you send a request</span>
          </Job>
        </>
      )}
      <Group>Workflows</Group>
      {workflows.error && <p className="ui-bad">{workflows.error}</p>}
      {workflows.data?.map((workflow) => (
        <Job key={workflow.id} label={workflow.name} enabled={workflow.enabled}
          disabled={busy !== undefined} toggle={(enabled) => void toggle(workflow.id, enabled)} />
      ))}
    </Card>
  );
}
