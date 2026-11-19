import { memo, useCallback, useState } from "react";
import type { TaskView } from "@shared/models";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import {
  Banner,
  Button,
  Card,
  Dialog,
  Dropdown,
  EmptyState,
  Input,
  SplitPane,
  StatusBadge,
  Textarea,
  PipelineMarks,
  Time,
  notifyError,
} from "../../ui";
import { diagramStages } from "./diagram";
import { TaskDetail } from "./TaskDetail";

const columns: Array<{ id: string; title: string; match: (t: TaskView) => boolean }> = [
  { id: "running", title: "Running", match: (t) => t.status === "running" },
  {
    id: "waiting",
    title: "Waiting on you",
    match: (t) => t.status === "waiting-gate" || t.status === "waiting-permission",
  },
  { id: "done", title: "Done", match: (t) => t.status === "done" },
  {
    id: "failed",
    title: "Failed",
    match: (t) => t.status === "failed" || t.status === "cancelled",
  },
];

export function NewTask({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  // The choices are the projects that are git repos, which is known once each project's status has been read.
  const projects = useQuery("projects.list", undefined, ["project.status"]);
  const workspace = useQuery("workspace.get");
  const pipelines = Object.entries(workspace.data?.workspace?.pipelines ?? {});
  const [projectId, setProjectId] = useState("");
  const [pipeline, setPipeline] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fanout, setFanout] = useState(1);
  const chosen = pipeline || pipelines[0]?.[0] || "";

  const create = async (): Promise<void> => {
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
      notifyError(err, "Could not start the task", "new-task");
    }
  };
  return (
    <Dialog
      title="New task"
      testId="new-task"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!projectId || !title.trim() || !chosen}
            onClick={() => void create()}
            data-testid="task-create"
          >
            Start the task
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="grid grid-cols-[100px_1fr] items-center gap-2">
          Project
          <Dropdown
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
          </Dropdown>
        </label>
        <label className="grid grid-cols-[100px_1fr] items-center gap-2">
          Pipeline
          <Dropdown
            value={chosen}
            onChange={(e) => setPipeline(e.target.value)}
            data-testid="task-pipeline"
          >
            {pipelines.map(([id, p]) => (
              <option key={id} value={id}>
                {p.name}
              </option>
            ))}
          </Dropdown>
        </label>
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="task-title"
        />
        <label className="grid grid-cols-[100px_1fr] items-center gap-2">
          Builders
          <Dropdown
            value={fanout}
            onChange={(e) => setFanout(Number(e.target.value))}
            data-testid="task-fanout"
          >
            <option value={1}>One builder</option>
            <option value={2}>Run with 2 builders and compare</option>
            <option value={3}>Run with 3 builders and compare</option>
            <option value={4}>Run with 4 builders and compare</option>
          </Dropdown>
        </label>
        <Textarea
          label="Description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-testid="task-description"
        />
      </div>
    </Dialog>
  );
}

const TaskCard = memo(function TaskCard({
  t,
  selected,
  onOpen,
}: {
  t: TaskView;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const ended = t.status === "done" || t.status === "cancelled" || t.status === "failed";
  return (
    <div
      data-testid="task-card"
      data-status={t.status}
      data-selected={selected ? "true" : undefined}
    >
      <Card onOpen={() => onOpen(t.id)}>
        <div className="grid gap-1">
          <div className="font-medium">{t.title}</div>
          <div className="ui-line-sub">{t.projectName}</div>
          <div className="ui-badges ui-line-sub">
            <StatusBadge status={t.status} />
            <span>{t.pipelineName}</span>
          </div>
          <PipelineMarks stages={diagramStages(t)} />
          <div className="ui-line-sub">
            {ended ? "Ended " : "Started "}
            <Time iso={ended ? t.updatedAt : t.createdAt} />
          </div>
        </div>
      </Card>
    </div>
  );
});

/** Tasks as cards moving through Running, Waiting on you, Done and Failed. */
export function BoardTab({
  initialTask,
  creating,
  onCloseCreate,
}: {
  initialTask?: string;
  creating: boolean;
  onCloseCreate: () => void;
}) {
  const tasks = useQuery("tasks.list", {}, ["task.changed"]);
  const [open, setOpen] = useState<string | null>(initialTask ?? null);
  const list = tasks.data ?? [];
  const pickTask = useCallback((id: string) => setOpen(id), []);
  const board = (
    <div className="grid content-start gap-4 pr-4">
      {tasks.error && <Banner tone="danger">{tasks.error}</Banner>}
      {list.length === 0 && (
        <EmptyState title="No tasks yet">
          Start one to run a pipeline. You approve between stages.
        </EmptyState>
      )}
      <div className="board-columns">
        {columns.map((c) => (
          <div key={c.id} data-testid={`column-${c.id}`} className="grid content-start gap-2">
            <h3 className="ui-group">
              {c.title} ({list.filter(c.match).length})
            </h3>
            {list.filter(c.match).map((t) => (
              <TaskCard key={t.id} t={t} selected={open === t.id} onOpen={pickTask} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="min-h-0 flex-1" data-testid="board-tab">
      <SplitPane
        id="board"
        defaultSize={620}
        min={320}
        minSecond={360}
        first={board}
        second={
          open ? (
            <div className="pl-4">
              <TaskDetail key={open} id={open} onClose={() => setOpen(null)} />
            </div>
          ) : (
            <div className="h-full pl-4">
              <div className="ui-surface h-full">
                <EmptyState title="Pick a task">
                  Its stages, output and approvals show here.
                </EmptyState>
              </div>
            </div>
          )
        }
      />
      {creating && (
        <NewTask
          onClose={onCloseCreate}
          onCreated={(id) => {
            onCloseCreate();
            setOpen(id);
            tasks.reload();
          }}
        />
      )}
    </div>
  );
}
