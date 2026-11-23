import { useState } from "react";
import {
  WorkflowMayDo, WorkflowOutput, WorkflowRead, workflowMayDoLabels, workflowOutputLabels, type Workflow,
} from "@shared/workflow";
import { validCron } from "@shared/schedule";
import { Button, Dialog, Dropdown, Input, Textarea } from "../../ui";
import { SchedulePicker } from "./SchedulePicker";

const mayDoHelp = {
  read: "Reads notes or files and reports back. Never changes anything.",
  brain: "Writes notes in the Brain, checks them and saves them with a commit.",
  project: "Edits files and runs checks in the chosen project.",
} as const;

export function WorkflowForm({ workflow, template, projects, providers, onSave, onClose, busy }: {
  workflow: Workflow | null;
  template?: Workflow;
  projects: Array<{ id: string; name: string }>;
  providers: Array<{ id: string; label: string }>;
  onSave: (workflow: Workflow) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Workflow>(workflow ?? template ?? {
    id: "", name: "", schedule: null, projectId: null, read: "brain", mayDo: "read", web: true, prompt: "",
    enabled: true, output: "worth-a-look",
  });
  const update = (patch: Partial<Workflow>) => setDraft((value) => ({ ...value, ...patch }));
  const id = workflow?.id ?? draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const scheduleBad = draft.schedule !== null && (!draft.schedule.trim() || !validCron(draft.schedule));
  const needsProject = draft.mayDo === "project" && !draft.projectId;
  const writes = draft.mayDo !== "read";
  const save = (): void => {
    if (scheduleBad || needsProject) return;
    void onSave({ ...draft, id, name: draft.name.trim(), schedule: draft.schedule?.trim() || null });
  };
  return (
    <Dialog title={workflow ? "Edit workflow" : "Add workflow"} onClose={onClose} wide footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !id || !draft.name.trim() || !draft.prompt.trim() || scheduleBad || needsProject}
          onClick={save}>Save workflow</Button>
      </>
    }>
      <div className="grid gap-3">
        {template && !workflow && <p className="ui-muted">This workflow starts off. Turn it on from Workflows when you are ready.</p>}
        <Input label="Name" value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={100} />
        <Textarea label="Prompt" value={draft.prompt} onChange={(event) => update({ prompt: event.target.value })} rows={4} maxLength={20000} />
        <SchedulePicker value={draft.schedule} onChange={(schedule) => update({ schedule })} />
        <label className="grid gap-1">
          <span className="ui-label">May do</span>
          <Dropdown aria-label="May do" value={draft.mayDo} onChange={(event) => update({ mayDo: WorkflowMayDo.parse(event.target.value) })}>
            {WorkflowMayDo.options.map((option) => <option key={option} value={option}>{workflowMayDoLabels[option]}</option>)}
          </Dropdown>
          <span className="ui-helper">{mayDoHelp[draft.mayDo]}</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.web} onChange={(event) => update({ web: event.target.checked })} />
          Web search and fetch
        </label>
        <label className="grid gap-1">
          <span className="ui-label">Run in</span>
          <Dropdown aria-label="Run in" value={draft.projectId ?? ""} onChange={(event) => {
            const projectId = event.target.value || null;
            update({ projectId, ...(!projectId && (draft.read === "both" || draft.read === "project") ? { read: "brain" } : {}) });
          }}>
            <option value="">Brain</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Dropdown>
          {needsProject && <span className="ui-helper ui-bad">Choose the project this workflow works in.</span>}
        </label>
        {draft.mayDo === "read" && <label className="grid gap-1">
          <span className="ui-label">May read</span>
          <Dropdown aria-label="May read" value={draft.read} onChange={(event) => update({ read: WorkflowRead.parse(event.target.value) })}>
            <option value="brain">Brain notes</option>
            {draft.projectId && <option value="project">Project files</option>}
            {draft.projectId && <option value="both">Project files and Brain notes</option>}
            <option value="none">Prompt only</option>
          </Dropdown>
        </label>}
        {draft.mayDo === "project" && <label className="grid gap-1">
          <span className="ui-label">How freely</span>
          <Dropdown aria-label="How freely" value={draft.autonomy ?? "act-on-risk"}
            onChange={(event) => update({ autonomy: event.target.value === "full-auto" ? "full-auto" : "act-on-risk" })}>
            <option value="act-on-risk">Act, ask on risk (risky steps are refused, nobody is there to ask)</option>
            <option value="full-auto">Full auto</option>
          </Dropdown>
        </label>}
        <label className="grid gap-1">
          <span className="ui-label">Send result to</span>
          <Dropdown aria-label="Send result to" value={draft.output} onChange={(event) => update({ output: WorkflowOutput.parse(event.target.value) })}>
            {WorkflowOutput.options.map((output) => <option key={output} value={output}>{workflowOutputLabels[output]}</option>)}
          </Dropdown>
        </label>
        <details open={Boolean(draft.model || draft.provider)}>
          <summary className="ui-label cursor-pointer">Agent and model</summary>
          <div className="grid gap-2 pt-2">
            <Dropdown aria-label="Agent tool" value={draft.provider ?? ""} onChange={(event) => update({ provider: event.target.value })}>
              <option value="">Choose automatically</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </Dropdown>
            <Input label="Model" placeholder={writes ? "Sonnet" : "Cheapest available"} value={draft.model ?? ""}
              onChange={(event) => update({ model: event.target.value })} />
          </div>
        </details>
      </div>
    </Dialog>
  );
}
