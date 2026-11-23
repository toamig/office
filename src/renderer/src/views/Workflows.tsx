import { Plus } from "lucide-react";
import { useState } from "react";
import { describeNext } from "@shared/schedule";
import { brainUpkeepTemplate, describeSchedule, workflowMayDoLabels, workflowOutputLabels, type Workflow, type WorkflowView } from "@shared/workflow";
import { formatTokens } from "../components/UsageMeter";
import { BackgroundRuns, useBackgroundRuns } from "../components/BackgroundRuns";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Banner, Button, Card, Dialog, EmptyState, OverflowMenu, Page, Time, notifyError } from "../ui";
import { WorkflowForm } from "./workflows/WorkflowForm";
import { ClaudeTasks } from "./workflows/ClaudeTasks";

const runLabels = { running: "Running", done: "Completed", failed: "Failed", cancelled: "Stopped" };

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

function WorkflowTimes({ workflow }: { workflow: WorkflowView }) {
  const schedule = describeSchedule(workflow.schedule);
  const last = workflow.lastRun;
  return <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
    <dt className="ui-muted">Schedule</dt>
    <dd>{workflow.valid ? <span>{schedule}</span> : <span className="ui-bad">Not a valid schedule</span>}</dd>
    <dt className="ui-muted">Next</dt>
    <dd>{workflow.nextRun ? <time dateTime={workflow.nextRun}>{describeNext(new Date(workflow.nextRun), new Date())}</time>
      : workflow.enabled ? "Only when you run it" : "Off"}</dd>
    <dt className="ui-muted">Last run</dt>
    <dd>{workflow.lastFiredAt ? <Time iso={workflow.lastFiredAt} /> : "Never"}
      {last?.tokens ? <span className="ui-muted"> {"·"} {formatTokens(last.tokens)}</span> : null}
      {last?.lateFor && <span className="ui-muted"> {"·"} Ran late (Office was closed at {clock.format(new Date(last.lateFor))})</span>}</dd>
    {last && <>
      <dt className="ui-muted">Result</dt>
      <dd>
        {last.result ? <details>
          <summary className="cursor-pointer">{runLabels[last.status]}</summary>
          <div className="text-selectable whitespace-pre-wrap break-words pt-2">{last.result}</div>
        </details> : runLabels[last.status]}
      </dd>
    </>}
  </dl>;
}

export function Workflows() {
  const list = useQuery("workflows.list", undefined, ["workspace.changed", "workflow.changed"]);
  const runs = useBackgroundRuns(true);
  const projects = useQuery("projects.list", undefined, ["workspace.changed"]);
  const providers = useQuery("providers.list");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [editor, setEditor] = useState<Workflow | null>();
  const [template, setTemplate] = useState(false);
  const [remove, setRemove] = useState<Workflow>();
  const [busy, setBusy] = useState<string[]>([]);
  const available = (projects.data ?? []).filter((project) => !project.archived);

  const act = async (id: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy((items) => [...items, id]);
    try {
      await work();
    } catch (error) {
      notifyError(error, "Could not complete the workflow action", id);
    } finally {
      setBusy((items) => items.filter((item) => item !== id));
      list.reload();
    }
  };
  const saving = busy.includes("editor");
  const deleting = remove && busy.includes(remove.id);

  return (
    <Page title="Workflows" testId="workflows"
      more={workspace.data?.workspace && workspace.data.workspace.vault.kind !== "none" ? [{
        label: "Use Brain upkeep template", onSelect: () => { setTemplate(true); setEditor(null); },
      }] : undefined} primary={
      <Button variant="primary" onClick={() => { setTemplate(false); setEditor(null); }}><Plus /> New workflow</Button>
    }>
      {list.error && <Banner tone="danger">{list.error}</Banner>}
      {runs.length > 0 && <Card title="Background runs"><BackgroundRuns runs={runs} /></Card>}
      {list.data?.length === 0 && <EmptyState title="No workflows yet" />}
      <ClaudeTasks onMoved={() => list.reload()} />
      {list.data?.map((workflow) => {
        const running = workflow.lastRun?.status === "running";
        const working = busy.includes(workflow.id);
        const projectName = available.find((project) => project.id === workflow.projectId)?.name;
        return (
          <Card key={workflow.id} title={workflow.name}>
            {workflow.alsoRunsIn && <Banner tone="attention">
              The Claude app also runs {workflow.alsoRunsIn} on this schedule, so each run would happen twice. Turn the task off in the Claude app.
            </Banner>}
            <div className="grid gap-4 lg:grid-cols-[minmax(10rem,1fr)_minmax(16rem,2fr)_auto]">
              <div className="min-w-0">
                <p className="ui-muted">{projectName ?? "Brain"}</p>
                <p>{workflowMayDoLabels[workflow.mayDo]}{workflow.web ? ", web on" : ""}</p>
                <p className="ui-muted">Result: {workflowOutputLabels[workflow.output]}</p>
              </div>
              <WorkflowTimes workflow={workflow} />
              <div className="flex flex-wrap items-start gap-2">
                <label className="flex items-center gap-2 py-1" title={`Enable ${workflow.name}`}>
                  <input type="checkbox" checked={workflow.enabled} disabled={working}
                    aria-label={`Enable ${workflow.name}`} onChange={(event) => {
                      const enabled = event.target.checked;
                      void act(workflow.id, () => office.invoke("workflows.setEnabled", { id: workflow.id, enabled }));
                    }} />
                  {workflow.enabled ? "On" : "Off"}
                </label>
                <Button size="sm" disabled={!workflow.enabled || running || working}
                  onClick={() => void act(workflow.id, () => office.invoke("workflows.runNow", { id: workflow.id }))}>
                  {running ? "Running" : "Run now"}
                </Button>
                <OverflowMenu label={`Actions for ${workflow.name}`} items={[
                  { label: "Edit", onSelect: () => setEditor(workflow) },
                  { label: "Delete", onSelect: () => setRemove(workflow) },
                ]} />
              </div>
            </div>
          </Card>
        );
      })}
      {editor !== undefined && <WorkflowForm key={editor?.id ?? (template ? "brain-upkeep" : "new-workflow")} workflow={editor}
        template={template ? brainUpkeepTemplate : undefined} projects={available} providers={providers.data ?? []}
        busy={saving} onClose={() => { if (!saving) setEditor(undefined); }}
        onSave={(workflow) => act("editor", async () => {
          await office.invoke(editor ? "workflows.save" : "workflows.create", workflow);
          setEditor(undefined);
        })} />}
      {remove && <Dialog title="Delete workflow" onClose={() => { if (!deleting) setRemove(undefined); }} footer={
        <>
          <Button disabled={deleting} onClick={() => setRemove(undefined)}>Cancel</Button>
          <Button variant="danger" disabled={deleting} onClick={() => void act(remove.id, async () => {
            await office.invoke("workflows.remove", { id: remove.id });
            setRemove(undefined);
          })}>Delete</Button>
        </>
      }>
        <p>Delete {remove.name} and stop its future runs?</p>
      </Dialog>}
    </Page>
  );
}
