import { Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { timeAgo, useQuery } from "../../lib/hooks";

const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };

/** Scheduled prompts on any project: a cron expression, a role and a prompt. Missed runs fire once at start. */
export function AutomationsPanel() {
  const automations = useQuery("automations.list", undefined, [
    "workspace.changed",
    "notification.new",
  ]);
  const projects = useQuery("projects.list");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const roles = Object.keys(workspace.data?.workspace?.roles ?? {});
  const [id, setId] = useState("");
  const [cron, setCron] = useState("0 3 * * *");
  const [project, setProject] = useState("");
  const [role, setRole] = useState("researcher");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await work();
      automations.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Panel title="Automations">
      <p className="mt-0 text-[12.5px]" style={{ color: "var(--muted)" }}>
        Each automation runs a prompt on a project on a schedule (cron: minute, hour, day, month,
        weekday). A run that was due while Office was closed happens once when it starts again.
      </p>
      {(error || automations.error) && (
        <div data-testid="automation-error">
          <ErrorBanner message={error ?? automations.error ?? ""} />
        </div>
      )}
      <div data-testid="automations">
        {automations.data?.length === 0 && <EmptyState>No automations yet.</EmptyState>}
        {automations.data?.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 border-b py-2"
            style={{ borderColor: "var(--line)" }}
            data-testid="automation-row"
          >
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
                {a.id} <code className="text-[12px]">{a.cron}</code>
                {!a.valid && <Chip tone="bad">invalid cron</Chip>}
              </div>
              <div className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
                {a.project} / {a.role}: {a.prompt}
              </div>
              <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                last run {a.lastFiredAt ? timeAgo(a.lastFiredAt) : "never"}, next{" "}
                {a.nextRun ? new Date(a.nextRun).toLocaleString() : "unknown"}
              </div>
            </div>
            <Button
              onClick={() => void run(() => office.invoke("automations.runNow", { id: a.id }))}
              data-testid="automation-run"
            >
              <Play size={13} /> Run now
            </Button>
            <Button
              variant="ghost"
              aria-label={`Delete ${a.id}`}
              onClick={() => void run(() => office.invoke("automations.remove", { id: a.id }))}
              data-testid="automation-delete"
            >
              <Trash2 size={13} />
            </Button>
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
        <div className="flex flex-wrap gap-2">
          <input
            className={field}
            style={fieldStyle}
            placeholder="id, for example nightly-brief"
            value={id}
            onChange={(e) => setId(e.target.value)}
            aria-label="Automation id"
            data-testid="automation-id"
          />
          <input
            className={field}
            style={fieldStyle}
            placeholder="cron"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            aria-label="Cron expression"
            data-testid="automation-cron"
          />
          <select
            className={field}
            style={fieldStyle}
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
          </select>
          <select
            className={field}
            style={fieldStyle}
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
          </select>
        </div>
        <textarea
          className={field}
          style={fieldStyle}
          rows={2}
          placeholder="The prompt to run"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label="Automation prompt"
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
    </Panel>
  );
}
