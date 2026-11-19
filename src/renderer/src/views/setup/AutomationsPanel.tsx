import { Play, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  StatusBadge,
  Textarea,
  Time,
  notifyError,
} from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Dropdown as Select } from "../../ui";

/** Scheduled prompts on any project: a cron expression, a role and a prompt. Missed runs fire once at start. */
export function AutomationsPanel() {
  const automations = useQuery("automations.list", undefined, ["workspace.changed", "run.done"]);
  const projects = useQuery("projects.list");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const roles = Object.keys(workspace.data?.workspace?.roles ?? {});
  const [id, setId] = useState("");
  const [cron, setCron] = useState("0 3 * * *");
  const [project, setProject] = useState("");
  const [role, setRole] = useState("researcher");
  const [prompt, setPrompt] = useState("");

  const run = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
      automations.reload();
    } catch (err) {
      notifyError(err, "That automation was not saved", "automations");
    }
  };

  return (
    <Card title="Automations" testId="panel-automations">
      <p className="ui-muted mt-0">
        Each automation runs a prompt on a project on a schedule (a cron schedule: minute, hour,
        day, month, weekday). A run that was due while Office was closed happens once when it starts
        again.
      </p>
      {automations.error && <p className="ui-bad">{automations.error}</p>}
      <div data-testid="automations">
        {automations.data?.length === 0 && (
          <EmptyState title="No automations yet">Add one below.</EmptyState>
        )}
        {automations.data?.map((a) => (
          <div key={a.id} className="ui-line" data-testid="automation-row">
            <input
              type="checkbox"
              checked={a.enabled}
              aria-label={`Enable ${a.id}`}
              onChange={(e) =>
                void run(() =>
                  office.invoke("automations.save", {
                    id: a.id,
                    cron: a.cron,
                    project: a.project,
                    role: a.role,
                    prompt: a.prompt,
                    enabled: e.target.checked,
                  }),
                )
              }
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {a.id} <code className="ui-path">{a.cron}</code>
                {!a.valid && <StatusBadge status="failed" label="Invalid schedule" />}
              </div>
              <div className="truncate text-[length:var(--text-xs)] ui-muted">
                {a.project} / {a.role}: {a.prompt}
              </div>
              <div className="text-[length:var(--text-xs)] ui-muted">
                Last run <Time iso={a.lastFiredAt} />, next{" "}
                {a.nextRun ? new Date(a.nextRun).toLocaleString() : "unknown"}
              </div>
            </div>
            <Button
              onClick={() => void run(() => office.invoke("automations.runNow", { id: a.id }))}
              data-testid="automation-run"
            >
              <Play /> Run now
            </Button>
            <IconButton
              label={`Delete ${a.id}`}
              onClick={() => void run(() => office.invoke("automations.remove", { id: a.id }))}
              data-testid="automation-delete"
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
      </div>
      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await office.invoke("automations.save", {
              id: id.trim(),
              cron: cron.trim(),
              project,
              role,
              prompt,
              enabled: true,
            });
            setId("");
            setPrompt("");
          });
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Automation name"
            placeholder="for example nightly-brief"
            value={id}
            onChange={(e) => setId(e.target.value)}
            data-testid="automation-id"
          />
          <Input
            label="Schedule (cron)"
            placeholder="0 3 * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            data-testid="automation-cron"
          />
          <Select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            aria-label="Automation project"
            data-testid="automation-project"
          >
            <option value="">Project...</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Automation role"
            data-testid="automation-role"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <Textarea
          label="Prompt"
          rows={2}
          placeholder="The prompt to run"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          data-testid="automation-prompt"
        />
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={!id.trim() || !project || !prompt.trim()}
            data-testid="automation-save"
          >
            Add automation
          </Button>
        </div>
      </form>
    </Card>
  );
}
