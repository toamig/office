import { ArrowDown, ArrowUp, Eye, GripVertical, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PIPELINE_TEMPLATES, STAGE_PRESETS, idFromName, roleFor, type StagePreset } from "@shared/pipeline-presets";
import { stageName, unknownVariables, variableLabel, variablesFor } from "@shared/pipeline-prompt";
import type { Pipeline } from "@shared/types";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import {
  Button,
  Card,
  Dialog,
  Dropdown,
  Group,
  IconButton,
  Input,
  PipelineDiagram,
  notifyDone,
  notifyError,
  sentence,
  type DiagramStage,
} from "../../ui";
import { PromptEditor } from "./PromptEditor";

type Stage = Pipeline["stages"][number];

const newStage = (taken: Iterable<string>, roleId: string, name = "New stage", preset?: StagePreset): Stage => ({
  id: idFromName(name, taken), name, role: roleId, exclude: [], gate: preset?.gate ?? false, worktree: preset?.worktree ?? false,
  prompt: preset?.prompt ?? "Do what the task describes.",
});

/** Exactly what a stage will receive: for a made-up task, or for a real task of this pipeline. */
function PromptPreview({ stages, index, pipelineId, onClose }: {
  stages: Stage[]; index: number; pipelineId: string | null; onClose: () => void;
}) {
  const tasks = useQuery("tasks.list", {}, ["task.changed"]);
  const mine = (tasks.data ?? []).filter((task) => pipelineId !== null && task.pipeline === pipelineId);
  const [taskId, setTaskId] = useState("");
  const [shown, setShown] = useState<{ prompt: string; unknown: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void office.invoke("pipelines.preview", { stages, index, ...(taskId ? { taskId } : {}) })
      .then((value) => { if (current) { setShown(value); setError(null); } })
      .catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { current = false; };
  }, [stages, index, taskId]);
  return (
    <Dialog title={`What ${stageName(stages[index]!)} receives`} wide onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="grid gap-3">
        <label className="grid gap-1">
          <span className="ui-label">For</span>
          <Dropdown aria-label="Preview for" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">A made-up task</option>
            {mine.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </Dropdown>
          {taskId && <span className="ui-helper">This uses the saved pipeline and the results the task has so far.</span>}
        </label>
        {error && <p className="ui-bad">{error}</p>}
        {shown && <pre className="text-selectable whitespace-pre-wrap" data-testid="prompt-preview">{shown.prompt}</pre>}
      </div>
    </Dialog>
  );
}

/** One pipeline: its stages, what each stage gets, prompts with variables as chips, presets, templates and a draft from a sentence. */
export function PipelineEditor({ id, pipeline, isNew, onSaved, onDeleted }: {
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
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [previewOf, setPreviewOf] = useState<number | null>(null);
  const inserts = useRef<Array<{ current: ((key: string) => void) | null }>>([]);

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
  const remove = (at: number): void =>
    setStages((all) => {
      const gone = all[at]?.id;
      return all.filter((_, j) => j !== at).map((s) => ({ ...s, exclude: s.exclude.filter((x) => x !== gone) }));
    });
  const addPreset = (value: string): void => {
    const preset = STAGE_PRESETS.find((entry) => entry.name === value);
    setStages((all) => [
      ...all,
      preset ? newStage(all.map((s) => s.id), roleFor(preset.roleHint, roles), preset.name, preset) : newStage(all.map((s) => s.id), roleIds[0] ?? ""),
    ]);
  };
  const fromTemplate = (value: string): void => {
    const template = PIPELINE_TEMPLATES.find((entry) => entry.name === value);
    if (!template) return;
    const made: Stage[] = [];
    for (const wanted of template.stages) {
      const preset = STAGE_PRESETS.find((entry) => entry.name === wanted);
      if (preset) made.push(newStage(made.map((s) => s.id), roleFor(preset.roleHint, roles), preset.name, preset));
    }
    setStages(made);
    if (!name.trim()) setName(template.name);
  };
  const draft = async (): Promise<void> => {
    setDrafting(true);
    try {
      const made = await office.invoke("pipelines.draft", { description });
      setStages(made.stages);
      setName((current) => current.trim() || made.name);
      notifyDone("Drafted", "Edit it, then save.", "pipeline-draft");
    } catch (err) {
      notifyError(err, "Could not draft a pipeline", "pipeline-draft");
    } finally {
      setDrafting(false);
    }
  };

  const unknownByStage = stages.map((s) => unknownVariables(s.prompt, stages));
  const hasUnknown = unknownByStage.some((list) => list.length > 0);
  const preview: DiagramStage[] = stages.map((s, i) => {
    const next = stages[i + 1];
    return {
      id: s.id || "stage",
      name: stageName(s),
      role: s.role || "role",
      provider: roles[s.role]?.provider ?? null,
      gate: s.gate,
      status: "pending",
      ...(next ? { passes: next.exclude.includes(s.id) ? "Task only" : `${stageName(s)} result` } : {}),
    };
  });

  const save = async (): Promise<void> => {
    const target = isNew ? idFromName(name, []) : id;
    try {
      await office.invoke("pipelines.save", { id: target, pipeline: { name, stages } });
      notifyDone("Pipeline saved", name, `pipeline-${target}`);
      onSaved(target);
    } catch (err) {
      notifyError(err, "That pipeline was not saved", `pipeline-${target}`);
    }
  };
  const removePipeline = async (): Promise<void> => {
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
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="pipeline-name" />
      <Card title="Describe it instead" testId="pipeline-draft">
        <div className="flex flex-wrap items-end gap-2">
          <Input className="min-w-64 flex-1" label="What should happen" value={description}
            placeholder="Plan with Opus, build in a worktree, I approve, then review"
            onChange={(e) => setDescription(e.target.value)} data-testid="pipeline-describe" />
          <Button disabled={drafting || description.trim().length < 3} onClick={() => void draft()} data-testid="pipeline-create-ai">
            <Sparkles /> {drafting ? "Drafting" : "Create with AI"}
          </Button>
          <label className="grid gap-1">
            <span className="ui-label">Or start from</span>
            <Dropdown aria-label="Start from a template" value="" onChange={(e) => fromTemplate(e.target.value)} data-testid="pipeline-template">
              <option value="">A template</option>
              {PIPELINE_TEMPLATES.map((template) => <option key={template.name} value={template.name}>{template.name}</option>)}
            </Dropdown>
          </label>
        </div>
      </Card>
      <Card title="How it will look" testId="pipeline-preview">
        {stages.length === 0 ? (
          <p className="ui-muted m-0">Add a stage to see the diagram.</p>
        ) : (
          <PipelineDiagram stages={preview} testId="pipeline-preview-diagram" />
        )}
      </Card>
      <Group>Stages</Group>
      <ol className="m-0 grid list-none gap-3 p-0" data-testid="stage-list">
        {stages.map((s, i) => {
          const earlier = stages.slice(0, i);
          const options = variablesFor(stages, i);
          const labelOf = (key: string): string => variableLabel(key, stages, i);
          const insert = (inserts.current[i] ??= { current: null });
          return (
            <li
              key={s.id}
              className="stage-card ui-surface grid gap-3 p-3"
              data-testid="stage-editor"
              data-dragging={dragged === i ? "true" : undefined}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragged !== null) move(dragged, i);
                setDragged(null);
              }}
            >
              <div className="flex flex-wrap items-end gap-2">
                {/* Only this handle starts a drag, so selecting text in the fields below never moves the card. */}
                <span
                  className="stage-grip"
                  draggable
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  data-testid="stage-grip"
                  onDragStart={(e) => {
                    setDragged(i);
                    e.dataTransfer.effectAllowed = "move";
                    const card = e.currentTarget.closest("li");
                    if (card) e.dataTransfer.setDragImage(card, 16, 16);
                  }}
                  onDragEnd={() => setDragged(null)}
                >
                  <GripVertical size={16} aria-hidden />
                </span>
                <span className="ui-muted w-6 text-center num">{i + 1}</span>
                <Input className="w-48" label="Name" value={stageName(s)} onChange={(e) => update(i, { name: e.target.value })} data-testid="stage-name" />
                <label className="grid gap-1">
                  <span className="ui-label">Role</span>
                  <Dropdown value={s.role} onChange={(e) => update(i, { role: e.target.value })} data-testid="stage-role">
                    {roleIds.map((r) => (
                      <option key={r} value={r}>
                        {sentence(r)}
                      </option>
                    ))}
                    {!roleIds.includes(s.role) && <option value={s.role}>{s.role}</option>}
                  </Dropdown>
                </label>
                <div className="flex-1" />
                <IconButton label="Move up" size="sm" disabled={i === 0} onClick={() => move(i, i - 1)} data-testid="stage-up">
                  <ArrowUp />
                </IconButton>
                <IconButton label="Move down" size="sm" disabled={i === stages.length - 1} onClick={() => move(i, i + 1)} data-testid="stage-down">
                  <ArrowDown />
                </IconButton>
                <IconButton label="Remove this stage" size="sm" onClick={() => remove(i)} data-testid="stage-remove">
                  <Trash2 />
                </IconButton>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={s.gate} onChange={(e) => update(i, { gate: e.target.checked })} data-testid="stage-gate" />{" "}
                  You approve after this stage
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={s.worktree} onChange={(e) => update(i, { worktree: e.target.checked })} data-testid="stage-worktree" />{" "}
                  Work in a new worktree
                </label>
              </div>
              <div className="grid gap-1" data-testid="stage-results">
                <span className="ui-label">Results this stage gets</span>
                {earlier.length === 0
                  ? <span className="ui-muted">It is the first stage. It gets the task: its title, description, project and branch.</span>
                  : <>
                    <span className="ui-helper">Every stage gets the task. Each earlier result below is passed on by itself; untick one to leave it out.</span>
                    <div className="flex flex-wrap gap-4">
                      {earlier.map((before) => (
                        <label key={before.id} className="flex items-center gap-2">
                          <input type="checkbox" checked={!s.exclude.includes(before.id)} data-testid="stage-include"
                            onChange={(e) => update(i, { exclude: e.target.checked ? s.exclude.filter((x) => x !== before.id) : [...s.exclude, before.id] })} />
                          Include result of {stageName(before)}
                        </label>
                      ))}
                    </div>
                  </>}
              </div>
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ui-label">Prompt</span>
                  <div className="flex items-center gap-2">
                    <Dropdown aria-label="Insert a variable" value="" onChange={(e) => { if (e.target.value) insert.current?.(e.target.value); }} data-testid="stage-insert">
                      <option value="">Insert a variable</option>
                      {(["Task", "Stages"] as const).map((group) => (
                        <optgroup key={group} label={group}>
                          {options.filter((option) => option.group === group).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                        </optgroup>
                      ))}
                    </Dropdown>
                    <Button size="sm" onClick={() => setPreviewOf(i)} data-testid="stage-preview">
                      <Eye /> Preview the prompt
                    </Button>
                  </div>
                </div>
                <PromptEditor
                  value={s.prompt}
                  onChange={(value) => update(i, { prompt: value })}
                  label={`Prompt of ${stageName(s)}`}
                  labelOf={labelOf}
                  isUnknown={(key) => unknownVariables(`{{${key}}}`, stages).length > 0}
                  insertRef={insert}
                  testId="stage-prompt"
                />
                {unknownByStage[i]?.length ? (
                  <span className="ui-helper ui-bad" data-testid="stage-unknown">
                    Not a known variable here: {unknownByStage[i]?.join(", ")}. Remove it or pick one from Insert a variable.
                  </span>
                ) : (
                  <span className="ui-helper">After this prompt the stage is also given what you have: the task and the results above.</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <label className="grid gap-1">
          <span className="sr-only">Add a stage</span>
          <Dropdown aria-label="Add a stage" value="" onChange={(e) => { if (e.target.value) addPreset(e.target.value); }} data-testid="stage-add">
            <option value="">Add a stage</option>
            <option value="__blank">A blank stage</option>
            {STAGE_PRESETS.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
          </Dropdown>
        </label>
        <Button variant="primary" disabled={!name.trim() || stages.length === 0 || hasUnknown} onClick={() => void save()} data-testid="pipeline-save">
          Save pipeline
        </Button>
        {!isNew && (
          <Button variant="danger" onClick={() => void removePipeline()} data-testid="pipeline-delete">
            Delete
          </Button>
        )}
      </div>
      {previewOf !== null && stages[previewOf] && (
        <PromptPreview stages={stages} index={previewOf} pipelineId={isNew ? null : id} onClose={() => setPreviewOf(null)} />
      )}
    </div>
  );
}
