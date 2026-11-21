import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { Button, Card, notifyError } from "../../ui";

export function WorthALook() {
  const results = useQuery("workflows.results", undefined, ["workflow.changed", "workspace.changed"]);
  const navigate = useUi((state) => state.navigate);
  if (!results.data?.length) return null;
  return (
    <Card title="Worth a look">
      {results.data.map((item) => (
        <div key={item.id} className="ui-line flex-wrap">
          <div className="ui-line-main">
            <div>{item.title}</div>
            {item.detail && <div className="ui-line-sub whitespace-pre-wrap">{item.detail}</div>}
          </div>
          <Button size="sm" onClick={() => navigate("agents", {
            start: "1", goal: item.title, prompt: [item.title, item.detail].filter(Boolean).join("\n\n"),
            ...(item.projectId ? { project: item.projectId } : {}),
          })}>Start a session</Button>
          <Button variant="ghost" size="sm" onClick={() => void office.invoke("workflows.dismiss", { id: item.id }).then(
            results.reload, (error) => notifyError(error, "Could not dismiss the suggestion", "workflow"),
          )}>Dismiss</Button>
        </div>
      ))}
    </Card>
  );
}
