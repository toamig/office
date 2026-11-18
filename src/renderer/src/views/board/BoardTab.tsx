import { Plus } from "lucide-react";
import { useState } from "react";
import type { TaskView } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { timeAgo, useQuery } from "../../lib/hooks";
import { TaskDetail } from "./TaskDetail";

const columns: Array<{ id: string; title: string; match: (t: TaskView) => boolean }> = [
  { id: "running", title: "Running", match: (t) => t.status === "running" },
  { id: "waiting", title: "Waiting on you", match: (t) => t.status === "waiting-gate" },
  { id: "done", title: "Done", match: (t) => t.status === "done" },
  {
    id: "failed",
    title: "Failed",
    match: (t) => t.status === "failed" || t.status === "cancelled",
  },
];

const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };

function NewTask({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const projects = useQuery("projects.list");
  const workspace = useQuery("workspace.get");
  const pipelines = Object.entries(workspace.data?.workspace?.pipelines ?? {});
  const [projectId, setProjectId] = useState("");
  const [pipeline, setPipeline] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fanout, setFanout] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const chosen = pipeline || pipelines[0]?.[0] || "";

  const create = async (): Promise<void> => {
    setError(null);
    try {
      const task = await office.invoke("tasks.create", {
        projectId,
        pipeline: chosen,
        title,
        description,
        fanout,
      });
      onCreated(task.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      data-testid="new-task"
    >
      <div
        className="w-[560px] rounded border p-4"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <h2 className="m-0 mb-3 text-sm font-semibold">New task</h2>
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-2.5">
          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            Project
            <select
              className={field}
              style={fieldStyle}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              data-testid="task-project"
            >
              <option value="">Choose a project</option>
              {(projects.data ?? [])
                .filter((p) => p.isRepo && !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            Pipeline
            <select
              className={field}
              style={fieldStyle}
              value={chosen}
              onChange={(e) => setPipeline(e.target.value)}
              data-testid="task-pipeline"
            >
              {pipelines.map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            Title
            <input
              className={field}
              style={fieldStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="task-title"
            />
          </label>
          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            Builders
            <select
              className={field}
              style={fieldStyle}
              value={fanout}
              onChange={(e) => setFanout(Number(e.target.value))}
              data-testid="task-fanout"
            >
              <option value={1}>One builder</option>
              <option value={2}>Run with 2 builders and compare</option>
              <option value={3}>Run with 3 builders and compare</option>
              <option value={4}>Run with 4 builders and compare</option>
            </select>
          </label>
          <label className="grid grid-cols-[100px_1fr] items-start gap-2">
            Description
            <textarea
              className={field}
              style={fieldStyle}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="task-description"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!projectId || !title.trim() || !chosen}
            onClick={() => void create()}
            data-testid="task-create"
          >
            Start the task
          </Button>
        </div>
      </div>
    </div>
  );
}

function Card({ t, selected, onOpen }: { t: TaskView; selected: boolean; onOpen: () => void }) {
  const stage = t.stages[Math.min(t.stageIndex, t.stages.length - 1)];
  const ended = t.status === "done" || t.status === "cancelled" || t.status === "failed";
  return (
    <div
      data-testid="task-card"
      data-status={t.status}
      onClick={onOpen}
      className="mb-2 cursor-pointer rounded border p-2.5"
      style={{
        background: "var(--panel)",
        borderColor: selected ? "var(--accent)" : "var(--line)",
      }}
    >
      <div className="font-medium">{t.title}</div>
      <div
        className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]"
        style={{ color: "var(--muted)" }}
      >
        <span>{t.projectName}</span>
        <Chip>{t.pipelineName}</Chip>
        {stage && (
          <Chip tone="warn">
            {stage.stageId}
            {stage.provider ? ` (${stage.role}, ${stage.provider})` : ""}
          </Chip>
        )}
        <span>{ended ? `ended ${timeAgo(t.updatedAt)}` : `started ${timeAgo(t.createdAt)}`}</span>
      </div>
    </div>
  );
}

/** Tasks as cards moving through Running, Waiting on you, Done and Failed. */
export function BoardTab({ initialTask }: { initialTask?: string }) {
  const tasks = useQuery("tasks.list", {}, ["task.changed"]);
  const [open, setOpen] = useState<string | null>(initialTask ?? null);
  const [creating, setCreating] = useState(false);
  const list = tasks.data ?? [];
  return (
    <div data-testid="board-tab">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1" style={{ color: "var(--muted)" }}>
          Each task moves through its pipeline; you approve between stages.
        </div>
        <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-task-open">
          <Plus size={13} /> New task
        </Button>
      </div>
      {tasks.error && <ErrorBanner message={tasks.error} />}
      {list.length === 0 && <EmptyState>No tasks yet. Start one to run a pipeline.</EmptyState>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="grid grid-cols-2 content-start gap-3">
          {columns.map((c) => (
            <div key={c.id} data-testid={`column-${c.id}`}>
              <div
                className="mb-1.5 text-[12px] font-semibold uppercase"
                style={{ color: "var(--muted)" }}
              >
                {c.title} ({list.filter(c.match).length})
              </div>
              {list.filter(c.match).map((t) => (
                <Card key={t.id} t={t} selected={open === t.id} onOpen={() => setOpen(t.id)} />
              ))}
            </div>
          ))}
        </div>
        <div>{open && <TaskDetail key={open} id={open} onClose={() => setOpen(null)} />}</div>
      </div>
      {creating && (
        <NewTask
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpen(id);
            tasks.reload();
          }}
        />
      )}
    </div>
  );
}
