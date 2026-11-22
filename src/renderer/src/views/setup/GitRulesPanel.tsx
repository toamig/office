import { useState } from "react";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { Button, Card, Dialog, notifyDone, notifyError } from "../../ui";

export function GitRulesPanel({ projectId }: { projectId?: string }) {
  const status = useQuery("rules.gitStatus", { projectId }, ["workspace.changed", "rules.changed"]);
  const [change, setChange] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const repos = status.data ?? [];
  if (!repos.length) return null;
  const all = repos.every((repo) => repo.installed);
  const some = repos.some((repo) => repo.installed);
  const apply = async (enabled: boolean) => {
    setBusy(true);
    try {
      await office.invoke("rules.gitConfigure", { projectId, enabled });
      notifyDone(enabled ? "Git rules enabled" : "Git rules removed", undefined, "git-rules");
      setChange(undefined);
    } catch (error) {
      notifyError(error, "Could not change Git rules", "git-rules");
    } finally {
      setBusy(false);
      status.reload();
    }
  };
  return <Card title={projectId ? "Project Git rules" : "Brain Git rules"}>
    <p className="mb-2 ui-muted">{projectId
      ? "Check staged files and commit messages using the Brain rule pack."
      : "Check Brain commits and sync them after they are saved."}</p>
    {repos.map((repo) => <div key={repo.name} className="ui-line">
      <span className="ui-line-main">{repo.name}</span>
      <span className="ui-muted">{repo.installed ? "Enabled" : "Off"}</span>
    </div>)}
    <div className="flex flex-wrap gap-2 pt-2">
      {!all && <Button disabled={busy} onClick={() => setChange(true)}>Enable Git rules</Button>}
      {some && <Button disabled={busy} onClick={() => setChange(false)}>Remove Git rules</Button>}
    </div>
    {change !== undefined && <Dialog title={change ? "Enable Git rules" : "Remove Git rules"}
      onClose={() => { if (!busy) setChange(undefined); }} footer={<>
        <Button disabled={busy} onClick={() => setChange(undefined)}>Cancel</Button>
        <Button disabled={busy} variant="primary" onClick={() => void apply(change)}>{change ? "Enable" : "Remove"}</Button>
      </>}>
      <p>{change ? "Existing hooks run first. Office then applies the checks from the current Brain rules." : "Restore the previous Git hook path."}</p>
      <ul>{repos.filter((repo) => repo.installed !== change).map((repo) => <li key={repo.name}>{repo.name}</li>)}</ul>
    </Dialog>}
  </Card>;
}
