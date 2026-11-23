import { useState } from "react";
import { describeSchedule } from "@shared/schedule";
import type { ClaudeTaskView } from "@shared/workflow";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { Banner, Button, Card, Dialog, ListRow, notifyError } from "../../ui";
import { SchedulePicker } from "./SchedulePicker";

/** Claude Code's scheduled tasks, read from the Claude app, each with Move to Office. */
export function ClaudeTasks({ onMoved }: { onMoved: () => void }) {
  const tasks = useQuery("workflows.claudeTasks", undefined, ["workspace.changed", "workflow.changed"]);
  const [moving, setMoving] = useState<ClaudeTaskView>();
  const [schedule, setSchedule] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState<string>();
  const list = tasks.data ?? [];
  if (list.length === 0) return null;

  const open = (task: ClaudeTaskView): void => { setMoving(task); setSchedule(task.schedule); setMoved(undefined); };
  const move = async (task: ClaudeTaskView): Promise<void> => {
    setBusy(true);
    try {
      await office.invoke("workflows.moveClaudeTask", { id: task.id, ...(task.schedule === null ? { schedule } : {}) });
      setMoved(task.name);
      tasks.reload();
      onMoved();
    } catch (error) {
      notifyError(error, "Could not move the task", task.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Scheduled in Claude Code" testId="claude-tasks">
      <p className="ui-muted pb-2">
        These run from the Claude app. Move one to Office to see it, change it and run it here. Office never changes the Claude app.
      </p>
      <div className="grid gap-1">
        {list.map((task) => (
          <ListRow key={task.id} testId={`claude-task-${task.id}`}
            trailing={task.movedAs
              ? <span className="ui-muted">Moved as {task.movedAs.name}</span>
              : <Button size="sm" onClick={() => open(task)}>Move to Office</Button>}>
            <p>{task.name}</p>
            <p className="ui-muted">{[
              task.schedule ? describeSchedule(task.schedule) : "Schedule not found",
              task.enabled === null ? null : task.enabled ? "On in the Claude app" : "Off in the Claude app",
              task.projectName,
            ].filter(Boolean).join(" · ")}</p>
            {task.runsTwice && <Banner tone="attention">
              Both the Claude app and the workflow {task.movedAs?.name} are on, so each run would happen twice. Turn the task off in the Claude app.
            </Banner>}
          </ListRow>
        ))}
      </div>
      {moving && <Dialog title={moved ? "Moved to Office" : `Move ${moving.name} to Office`} onClose={() => { if (!busy) setMoving(undefined); }} footer={
        moved ? <Button variant="primary" onClick={() => setMoving(undefined)}>Done</Button> : <>
          <Button disabled={busy} onClick={() => setMoving(undefined)}>Cancel</Button>
          <Button variant="primary" disabled={busy || (moving.schedule === null && schedule === undefined)} onClick={() => void move(moving)}>Move to Office</Button>
        </>
      }>
        {moved ? <div className="grid gap-2">
          <p>{moved} is now a workflow, switched off.</p>
          <p>One step is left: turn the task off in the Claude app, then turn this workflow on.</p>
        </div> : <div className="grid gap-3">
          <p>Office makes a workflow from the task's prompt. It may write in the Brain and use web search, and it starts switched off.</p>
          {moving.schedule === null && <>
            <Banner tone="attention">Office could not read this task's schedule from the Claude app. Set it here.</Banner>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </>}
          {moving.schedule !== null && <p className="ui-muted">Schedule: {describeSchedule(moving.schedule)}</p>}
        </div>}
      </Dialog>}
    </Card>
  );
}
