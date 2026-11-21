import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AppSettingsPatch } from "@shared/models";
import type { Workflow } from "@shared/workflow";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Button, Card, Group, Input, OverflowMenu, Time, notifyDone, notifyError } from "../../ui";
import { OUTPUT_NAMES, WorkflowForm, scheduleLabel } from "./WorkflowForm";

function Job({ label, enabled, toggle, children }: {
  label: string; enabled: boolean; toggle: (on: boolean) => void; children: ReactNode;
}) {
  return (
    <div className="ui-line flex-wrap">
      <label className="flex min-w-36 items-center gap-2 font-medium">
        <input type="checkbox" checked={enabled} onChange={(event) => toggle(event.target.checked)} />
        {label}
      </label>
      {children}
    </div>
  );
}

function ModelField({ job, model, save }: { job: string; model: string; save: (value: string) => void }) {
  return <Input key={model} hideLabel label={`${job} model`} defaultValue={model} placeholder="Cheapest available"
    maxLength={120} onBlur={(event) => { if (model !== event.target.value.trim()) save(event.target.value.trim()); }} />;
}

export function BackgroundAiPanel() {
  const settings = useQuery("settings.get", undefined, ["settings.changed", "workspace.changed"]);
  const workflows = useQuery("workflows.list", undefined, ["workspace.changed", "run.done", "workflow.changed"]);
  const projects = useQuery("projects.list", undefined, ["workspace.changed"]);
  const providers = useQuery("providers.list");
  const [edit, setEdit] = useState<Workflow | null>();
  const [busy, setBusy] = useState<string>();
  const s = settings.data;
  const set = async (patch: AppSettingsPatch): Promise<void> => {
    try {
      await office.invoke("settings.set", patch);
      settings.reload();
    } catch (error) { notifyError(error, "Could not change Background AI", "background-ai"); }
  };
  const act = async (id: string, work: () => Promise<void>): Promise<void> => {
    setBusy(id);
    try {
      await work();
      workflows.reload();
    } catch (error) { notifyError(error, "Could not finish the workflow action", "workflow"); }
    finally { setBusy(undefined); }
  };
  return (
    <Card title="Background AI" testId="panel-background-ai">
      {s && (
        <>
          <Job label="Morning brief" enabled={s.briefEnabled} toggle={(briefEnabled) => void set({ briefEnabled })}>
            <ModelField job="Morning brief" model={s.briefModel} save={(briefModel) => void set({ briefModel })} />
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
      <div className="mt-4 flex items-center justify-between">
        <Group>Workflows</Group>
        <Button size="sm" onClick={() => setEdit(null)}><Plus /> Add workflow</Button>
      </div>
      {workflows.error && <p className="ui-bad">{workflows.error}</p>}
      {workflows.data?.map((workflow) => (
        <div className="ui-line flex-wrap" key={workflow.id}>
          <input type="checkbox" checked={workflow.enabled} disabled={busy !== undefined}
            aria-label={`Enable ${workflow.name}`} onChange={(event) => {
              const enabled = event.target.checked;
              void act(workflow.id, () => office.invoke("workflows.save", { ...workflow, enabled }));
            }} />
          <div className="ui-line-main">
            <div>{workflow.name}</div>
            <div className="ui-line-sub">{scheduleLabel(workflow.schedule)} · {workflow.model || "Cheapest available"} · {OUTPUT_NAMES[workflow.output]}</div>
            {!workflow.valid && <div className="ui-bad">Invalid schedule</div>}
            {workflow.lastFiredAt && <div className="ui-line-sub">Last run <Time iso={workflow.lastFiredAt} /></div>}
          </div>
          <Button size="sm" disabled={!workflow.enabled || busy !== undefined} onClick={() =>
            void act(workflow.id, async () => {
              await office.invoke("workflows.runNow", { id: workflow.id });
              notifyDone("Workflow finished", undefined, workflow.id);
            })}>{busy === workflow.id ? "Working..." : "Run now"}</Button>
          <OverflowMenu label={`Actions for ${workflow.name}`} items={[
            { label: "Edit", onSelect: () => setEdit(workflow) },
            { label: "Remove", onSelect: () => void act(workflow.id, () => office.invoke("workflows.remove", { id: workflow.id })) },
          ]} />
        </div>
      ))}
      {edit !== undefined && <WorkflowForm workflow={edit} projects={(projects.data ?? []).filter((project) => !project.archived)}
        providers={providers.data ?? []} busy={busy !== undefined} onClose={() => setEdit(undefined)}
        onSave={(workflow) => act(workflow.id, async () => {
          await office.invoke("workflows.save", workflow);
          setEdit(undefined);
        })} />}
    </Card>
  );
}
