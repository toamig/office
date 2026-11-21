import { useState } from "react";
import { WorkflowOutput, WorkflowRead, type Workflow } from "@shared/workflow";
import { Button, Dialog, Dropdown, Input, Textarea } from "../../ui";

export const OUTPUT_NAMES: Record<Workflow["output"], string> = {
  "worth-a-look": "Worth a look", pending: "Needs you", note: "Brain note",
};

const schedules = {
  manual: { pattern: null, label: "On demand" },
  daily: { pattern: "0 8 * * *", label: "Daily at 08:00" },
  weekly: { pattern: "0 8 * * 1", label: "Mondays at 08:00" },
  custom: { pattern: "", label: "Custom schedule" },
} as const;

export const scheduleLabel = (schedule: string | null) =>
  Object.values(schedules).find((item) => item.pattern === schedule)?.label ?? schedule ?? "On demand";

export function WorkflowForm({ workflow, projects, providers, onSave, onClose, busy }: {
  workflow: Workflow | null;
  projects: Array<{ id: string; name: string }>;
  providers: Array<{ id: string; label: string }>;
  onSave: (workflow: Workflow) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Workflow>(workflow ?? {
    id: "", name: "", schedule: null, projectId: null, read: "brain", prompt: "",
    enabled: true, output: "worth-a-look",
  });
  const initial = Object.entries(schedules).find(([, item]) => item.pattern === draft.schedule)?.[0];
  const [frequency, setFrequency] = useState(initial ?? "custom");
  const update = (patch: Partial<Workflow>) => setDraft((value) => ({ ...value, ...patch }));
  const id = workflow?.id ?? draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const schedule = frequency === "custom" ? draft.schedule?.trim() : schedules[frequency as keyof typeof schedules].pattern;
  const save = (): void => {
    if (schedule === undefined || (frequency === "custom" && !schedule)) return;
    void onSave({ ...draft, id, name: draft.name.trim(), schedule });
  };
  return (
    <Dialog title={workflow ? "Edit workflow" : "Add workflow"} onClose={onClose} wide footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !id || !draft.name.trim() || !draft.prompt.trim() || (frequency === "custom" && !schedule)}
          onClick={save}>Save workflow</Button>
      </>
    }>
      <div className="grid gap-3">
        <Input label="Name" value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={100} />
        <Textarea label="Prompt" value={draft.prompt} onChange={(event) => update({ prompt: event.target.value })} rows={4} maxLength={20000} />
        <label className="grid gap-1">
          <span className="ui-label">Run in</span>
          <Dropdown aria-label="Run in" value={draft.projectId ?? ""} onChange={(event) => {
            const projectId = event.target.value || null;
            update({ projectId, ...(!projectId && (draft.read === "both" || draft.read === "project") ? { read: "brain" } : {}) });
          }}>
            <option value="">Brain</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Dropdown>
        </label>
        <label className="grid gap-1">
          <span className="ui-label">May read</span>
          <Dropdown aria-label="May read" value={draft.read} onChange={(event) => update({ read: WorkflowRead.parse(event.target.value) })}>
            <option value="brain">Brain notes</option>
            {draft.projectId && <option value="project">Project files</option>}
            {draft.projectId && <option value="both">Project files and Brain notes</option>}
            <option value="none">Prompt only</option>
          </Dropdown>
        </label>
        <label className="grid gap-1">
          <span className="ui-label">Schedule</span>
          <Dropdown aria-label="Schedule" value={frequency} onChange={(event) => setFrequency(event.target.value)}>
            {Object.entries(schedules).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
          </Dropdown>
        </label>
        {frequency === "custom" && <Input label="Cron schedule" value={draft.schedule ?? ""} onChange={(event) => update({ schedule: event.target.value })} />}
        <label className="grid gap-1">
          <span className="ui-label">Send result to</span>
          <Dropdown aria-label="Send result to" value={draft.output} onChange={(event) => update({ output: WorkflowOutput.parse(event.target.value) })}>
            {WorkflowOutput.options.map((output) => <option key={output} value={output}>{OUTPUT_NAMES[output]}</option>)}
          </Dropdown>
        </label>
        <details open={Boolean(draft.model || draft.provider)}>
          <summary className="ui-label cursor-pointer">Agent and model</summary>
          <div className="grid gap-2 pt-2">
            <Dropdown aria-label="Agent tool" value={draft.provider ?? ""} onChange={(event) => update({ provider: event.target.value })}>
              <option value="">Choose automatically</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </Dropdown>
            <Input label="Model" placeholder="Cheapest available" value={draft.model ?? ""} onChange={(event) => update({ model: event.target.value })} />
          </div>
        </details>
      </div>
    </Dialog>
  );
}
