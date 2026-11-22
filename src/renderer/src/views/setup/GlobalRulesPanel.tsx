import { useEffect, useState } from "react";
import type { ChannelRes } from "@shared/ipc";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { Button, Card, Dialog, notifyDone, notifyError } from "../../ui";

type Proposal = ChannelRes<"rules.globalPreview"> & { remove: boolean };

export function GlobalRulesPanel({ onboarding = false }: { onboarding?: boolean }) {
  const status = useQuery("rules.globalStatus", undefined, ["rules.changed", "workspace.changed"]);
  const requested = useUi((state) => state.params["instructions"]);
  const [plan, setPlan] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const available = status.data?.available;
  const review = onboarding || !!requested;

  useEffect(() => {
    if (!review || !available) return;
    let open = true;
    void office.invoke("rules.globalPreview", { remove: false }).then((result) => {
      if (open && result.changes.length) setPlan({ ...result, remove: false });
    }, (error) => { if (open) notifyError(error, "Could not preview agent instructions", "agent-rules"); });
    return () => { open = false; };
  }, [available, review]);

  const preview = async (remove: boolean) => {
    try {
      const result = await office.invoke("rules.globalPreview", { remove });
      if (result.changes.length) setPlan({ ...result, remove });
      else notifyDone("Agent instructions are up to date", undefined, "agent-rules");
    } catch (error) {
      notifyError(error, "Could not preview agent instructions", "agent-rules");
    }
  };
  const finish = async (work: () => Promise<void>, title: string) => {
    setBusy(true);
    try {
      await work();
      setPlan(undefined);
      notifyDone(title, undefined, "agent-rules");
    } catch (error) {
      notifyError(error, "Could not change agent instructions", "agent-rules");
    } finally {
      setBusy(false);
      status.reload();
    }
  };
  const installed = status.data?.tools.some((tool) => tool.installed || tool.conflict);
  if (!available && !installed) return null;
  return <Card title={onboarding ? undefined : "Agent instructions"}>
    {status.data?.tools.map((tool) => <div className="ui-line" key={tool.id}>
      <span className="ui-line-main">{tool.label}</span><span className="ui-muted">
        {tool.conflict ? "Review edits" : tool.installed ? "Installed" : "Available"}
      </span>
    </div>)}
    <div className="flex flex-wrap gap-2 pt-2">
      {available && <Button disabled={busy} onClick={() => void preview(false)}>Review instructions</Button>}
      {installed && <Button disabled={busy} onClick={() => void preview(true)}>Remove instructions</Button>}
      {status.data?.undo && <Button disabled={busy} onClick={() => void finish(() => office.invoke("rules.globalUndo"), "Agent instructions restored")}>Undo update</Button>}
    </div>
    {plan && <Dialog title={plan.remove ? "Remove agent instructions" : "Install agent instructions"} wide
      onClose={() => { if (!busy) setPlan(undefined); }} footer={<>
        <Button disabled={busy} onClick={() => setPlan(undefined)}>Cancel</Button>
        <Button disabled={busy} variant="primary" onClick={() => void finish(
          () => office.invoke("rules.globalApply", { id: plan.id }),
          plan.remove ? "Agent instructions removed" : "Agent instructions installed",
        )}>{plan.remove ? "Remove" : "Install"}</Button>
      </>}>
      {plan.changes.map((change) => <section key={change.file} className="mb-3">
        <h3>{change.label}</h3>
        <p className="ui-path break-all">{change.file}</p>
        <pre className="ui-code whitespace-pre-wrap">{change.diff}</pre>
      </section>)}
    </Dialog>}
  </Card>;
}
