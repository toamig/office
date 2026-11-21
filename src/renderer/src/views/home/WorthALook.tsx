import { useEffect, useState } from "react";
import type { WorkflowResult } from "@shared/workflow";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { Button, Card, Time, notifyError } from "../../ui";

function Suggestion({ item, projects, reload }: {
  item: WorkflowResult;
  projects: ReadonlyMap<string, string>;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const navigate = useUi((state) => state.navigate);
  const act = async (action: "discuss" | "later" | "dismiss") => {
    setBusy(true);
    try {
      if (action === "discuss") {
        const link = await office.invoke("workflows.discuss", { id: item.id });
        navigate("explore", link.params);
      } else {
        await office.invoke(action === "later" ? "workflows.later" : "workflows.dismiss", { id: item.id });
        reload();
      }
    } catch (error) {
      notifyError(error, "Could not update the suggestion", item.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="ui-line flex-col items-start gap-2" data-testid="workflow-suggestion">
      <h4 className="font-medium">{item.title}</h4>
      {item.why && <p className="text-selectable whitespace-pre-wrap break-words">{item.why}</p>}
      {item.projectIds.length > 0 && <p className="ui-muted">{item.projectIds.map((id) => projects.get(id) ?? id).join(", ")}</p>}
      {item.firstStep && <p><span className="ui-muted">First step </span>{item.firstStep}</p>}
      {item.sources.length > 0 && <details className="max-w-full">
        <summary className="ui-muted cursor-pointer">Sources ({item.sources.length})</summary>
        <ul className="list-disc pl-5">
          {item.sources.map((source, index) => <li key={index} className="text-selectable break-all">{source}</li>)}
        </ul>
      </details>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void act("discuss")}>Discuss</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act("later")}>Later</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act("dismiss")}>Dismiss</Button>
      </div>
    </article>
  );
}

export function WorthALook() {
  const results = useQuery("workflows.results", undefined, ["workflow.changed", "workspace.changed"]);
  const projects = useQuery("projects.list", undefined, ["workspace.changed"]);
  const reload = results.reload;
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000);
    window.addEventListener("focus", reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, [reload]);
  if (!results.data?.length) return null;
  const names = new Map(projects.data?.map((project) => [project.id, project.name]));
  const groups = new Map<string, WorkflowResult[]>();
  for (const item of results.data) {
    const group = groups.get(item.runId);
    if (group) group.push(item);
    else groups.set(item.runId, [item]);
  }
  return (
    <Card title="Worth a look" testId="worth-a-look">
      {[...groups].map(([id, items]) => (
        <section key={id} className="py-2">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">{items[0]?.workflowName}</h3>
            <span className="ui-muted"><Time iso={items[0]?.createdAt} /></span>
          </header>
          {items.map((item) => <Suggestion key={item.id} item={item} projects={names} reload={reload} />)}
        </section>
      ))}
    </Card>
  );
}
