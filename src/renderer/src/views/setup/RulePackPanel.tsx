import { useState } from "react";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { useUi } from "../../stores/ui";
import { Button, Card, notifyDone, notifyError } from "../../ui";

export function RulePackPanel() {
  const rules = useQuery("rules.status", undefined, ["workspace.changed", "rules.changed"]);
  const requested = useUi((state) => state.params["rules"]);
  const [busy, setBusy] = useState(false);
  const status = rules.data;
  if (!status || (!status.add.length && !status.conflicts.length && !status.undo.length)) return null;
  const change = async (work: () => Promise<void>, title: string) => {
    setBusy(true);
    try {
      await work();
      notifyDone(title, undefined, "starter-rules");
    } catch (error) {
      notifyError(error, "Could not change the Brain rules", "starter-rules");
    } finally {
      setBusy(false);
      rules.reload();
    }
  };
  return <Card title="Brain rule pack">
    {status.add.length > 0 && <div className="grid justify-items-start gap-2">
      <p>Office will add these files to your Brain.</p>
      <ul>{status.add.map((path) => <li key={path} className="ui-path">{path}</li>)}</ul>
      <Button disabled={busy} onClick={() => void change(
        () => office.invoke("rules.add", { files: status.add }), "Brain rule pack added")}>Add the rule pack</Button>
    </div>}
    {status.conflicts.map(({ path, before, after, diff }) => <details key={path} open={requested === path || undefined} className="py-2">
      <summary className="cursor-pointer">{path}</summary>
      <pre className="ui-code whitespace-pre-wrap">{diff}</pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void change(
          () => office.invoke("rules.answer", { path, before, after, accept: true }), "Rule updated")}>Use the new version</Button>
        <Button size="sm" disabled={busy} onClick={() => void change(
          () => office.invoke("rules.answer", { path, before, after, accept: false }), "Kept your rule")}>Keep mine</Button>
      </div>
    </details>)}
    {status.undo.length > 0 && <div className="ui-line">
      <div className="ui-line-main"><p>Starter rules updated</p><p className="ui-muted">{status.undo.join(", ")}</p></div>
      <Button size="sm" disabled={busy} onClick={() => void change(() => office.invoke("rules.undo"), "Rule update undone")}>Undo</Button>
    </div>}
  </Card>;
}
