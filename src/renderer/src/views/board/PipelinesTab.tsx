import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Pipeline } from "@shared/types";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import {
  Button,
  Card,
  Dropdown,
  EmptyState,
  Group,
  IconButton,
  Input,
  PipelineDiagram,
  SplitPane,
  Textarea,
  notifyDone,
  notifyError,
  sentence,
  type DiagramStage,
} from "../../ui";

type Stage = Pipeline["stages"][number];

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function PipelineEditor({
  id,
  pipeline,
  isNew,
  onSaved,
  onDeleted,
}: {
  id: string;
  pipeline: Pipeline;
  isNew: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const roles = workspace.data?.workspace?.roles ?? {};
  const roleIds = Object.keys(roles);
  const [name, setName] = useState(pipeline.name);
  const [stages, setStages] = useState<Stage[]>(pipeline.stages);
  const [dragged, setDragged] = useState<number | null>(null);

  const update = (i: number, patch: Partial<Stage>): void =>
    setStages((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (from: number, to: number): void =>
    setStages((all) => {
      if (to < 0 || to >= all.length || from === to) return all;
      const next = [...all];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  const add = (): void =>
    setStages((all) => {
      let n = all.length + 1;
      while (all.some((s) => s.id === `stage-${n}`)) n++;
      return [
        ...all,
        {
          id: `stage-${n}`,
          role: roleIds[0] ?? "",
          gate: false,
          worktree: false,
          prompt: "{{task.description}}",
        },
      ];
    });

  const preview: DiagramStage[] = stages.map((s) => ({
    id: s.id || "stage",
    role: s.role || "role",
    provider: roles[s.role]?.provider ?? null,
    gate: s.gate,
    status: "pending",
  }));

  const save = async (): Promise<void> => {
    const target = isNew ? slug(name) : id;
    try {
      await office.invoke("pipelines.save", { id: target, pipeline: { name, stages } });
      notifyDone("Pipeline saved", name, `pipeline-${target}`);
      onSaved(target);
    } catch (err) {
      notifyError(err, "That pipeline was not saved", `pipeline-${target}`);
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await office.invoke("pipelines.remove", { id });
      onDeleted();
    } catch (err) {
      notifyError(err, "That pipeline was not removed", `pipeline-${id}`);
    }
  };

  return (
    <div className="grid content-start gap-4 p-4" data-testid="pipeline-editor">
      <h2 className="m-0 text-[length:var(--text-lg)]">{isNew ? "New pipeline" : pipeline.name}</h2>
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="pipeline-name"
      />
      <Card title="How it will look" testId="pipeline-preview">
        {stages.length === 0 ? (
          <p className="ui-muted m-0">Add a stage to see the diagram.</p>
        ) : (
          <PipelineDiagram stages={preview} testId="pipeline-preview-diagram" />
        )}
      </Card>
      <Group>Stages</Group>
      <ol className="m-0 grid list-none gap-3 p-0" data-testid="stage-list">
        {stages.map((s, i) => (
          <li
            key={`${i}-${s.id}`}
            className="ui-surface grid gap-3 p-3"
            data-testid="stage-editor"
            draggable
            onDragStart={() => setDragged(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragged !== null) move(dragged, i);
              setDragged(null);
            }}
          >
            <div className="flex items-end gap-2">
              <span className="ui-muted w-6 text-center num">{i + 1}</span>
              <Input
                className="w-40"
                label="Stage id"
                value={s.id}
                onChange={(e) => update(i, { id: slug(e.target.value) || e.target.value })}
                data-testid="stage-id"
              />
              <label className="grid gap-1">
                <span className="ui-label">Role</span>
                <Dropdown
                  value={s.role}
                  onChange={(e) => update(i, { role: e.target.value })}
                  data-testid="stage-role"
                >
                  {roleIds.map((r) => (
                    <option key={r} value={r}>
                      {sentence(r)}
                    </option>
                  ))}
                  {!roleIds.includes(s.role) && <option value={s.role}>{s.role}</option>}
                </Dropdown>
              </label>
              <div className="flex-1" />
              <IconButton
                label="Move up"
                size="sm"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                data-testid="stage-up"
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                label="Move down"
                size="sm"
                disabled={i === stages.length - 1}
                onClick={() => move(i, i + 1)}
                data-testid="stage-down"
              >
                <ArrowDown />
              </IconButton>
              <IconButton
                label="Remove this stage"
                size="sm"
                onClick={() => setStages((all) => all.filter((_, j) => j !== i))}
                data-testid="stage-remove"
              >
                <Trash2 />
              </IconButton>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.gate}
                  onChange={(e) => update(i, { gate: e.target.checked })}
                  data-testid="stage-gate"
                />{" "}
                You approve after this stage
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.worktree}
                  onChange={(e) => update(i, { worktree: e.target.checked })}
                  data-testid="stage-worktree"
                />{" "}
                Work in a new worktree
              </label>
            </div>
            <Textarea
              label="Prompt"
              rows={3}
              value={s.prompt}
              onChange={(e) => update(i, { prompt: e.target.value })}
              data-testid="stage-prompt"
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={add} data-testid="stage-add">
          <Plus /> Add a stage
        </Button>
        <Button
          variant="primary"
          disabled={!name.trim() || stages.length === 0 || (isNew && slug(name) === "")}
          onClick={() => void save()}
          data-testid="pipeline-save"
        >
          Save pipeline
        </Button>
        {!isNew && (
          <Button variant="danger" onClick={() => void remove()} data-testid="pipeline-delete">
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

/** Pipelines: the stages a task goes through, each with a role, an optional approval and a prompt. */
export function PipelinesTab() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const pipelines = workspace.data?.workspace?.pipelines ?? {};
  const ids = Object.keys(pipelines);
  const [selected, setSelected] = useState("");
  const [fresh, setFresh] = useState(false);
  const current = fresh ? undefined : pipelines[selected] ? selected : ids[0];

  const list = (
    <div className="p-2" data-testid="pipeline-list">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="ui-group m-0">Pipelines</h3>
        <Button size="sm" onClick={() => setFresh(true)} data-testid="new-pipeline">
          <Plus /> New pipeline
        </Button>
      </div>
      {ids.length === 0 && (
        <EmptyState title="No pipelines">Make one with New pipeline.</EmptyState>
      )}
      {ids.map((pid) => (
        <div
          key={pid}
          data-testid="pipeline-row"
          className="ui-row"
          role="button"
          tabIndex={0}
          data-clickable="true"
          data-selected={current === pid ? "true" : undefined}
          onClick={() => {
            setFresh(false);
            setSelected(pid);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setFresh(false);
              setSelected(pid);
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium">{pipelines[pid]?.name}</div>
            <div className="ui-line-sub">
              {pipelines[pid]?.stages.map((s) => sentence(s.id)).join(", ")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-0 flex-1" data-testid="pipelines-tab">
      <SplitPane
        id="pipelines"
        defaultSize={320}
        min={240}
        minSecond={520}
        first={list}
        second={
          fresh ? (
            <PipelineEditor
              key="new"
              id=""
              isNew
              pipeline={{ name: "", stages: [] }}
              onSaved={(pid) => {
                setFresh(false);
                setSelected(pid);
              }}
              onDeleted={() => setFresh(false)}
            />
          ) : current && pipelines[current] ? (
            <PipelineEditor
              key={current}
              id={current}
              isNew={false}
              pipeline={pipelines[current] as Pipeline}
              onSaved={setSelected}
              onDeleted={() => setSelected("")}
            />
          ) : (
            <EmptyState title="No pipeline">Pick one on the left.</EmptyState>
          )
        }
      />
    </div>
  );
}
