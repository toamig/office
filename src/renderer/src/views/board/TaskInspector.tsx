import { Markdown } from "../../components/Markdown";
import { useQuery } from "../../lib/hooks";
import { Card, PipelineDiagram, sentence } from "../../ui";
import { diagramStages } from "./diagram";

/** The selected task on the side: its pipeline as a diagram and each stage's output. */
export function TaskInspector({ id }: { id: string | null }) {
  const task = useQuery("tasks.get", { id: id ?? "" }, ["task.changed"]);
  const t = id ? task.data : undefined;
  if (!t) {
    return (
      <Card title="Task" testId="task-inspector">
        <p className="ui-muted m-0">Pick a task to see its pipeline and what each stage wrote.</p>
      </Card>
    );
  }
  return (
    <>
      <Card title={t.title} testId="task-inspector">
        <PipelineDiagram stages={diagramStages(t)} vertical testId="inspector-diagram" />
      </Card>
      {t.stages.map((s) => (
        <Card key={s.stageId} title={`${sentence(s.stageId)} output`} testId="inspector-output">
          {t.outputs[s.stageId] ? (
            <div className="reading">
              <Markdown>{t.outputs[s.stageId] as string}</Markdown>
            </div>
          ) : (
            <p className="ui-muted m-0">No output yet.</p>
          )}
        </Card>
      ))}
    </>
  );
}
