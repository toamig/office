import { useEffect, useState } from "react";
import { BRIEF_RANGE_LABELS, BriefRange, type BriefCard } from "@shared/brief";
import { office } from "../../lib/ipc";
import { Button, Dialog, Dropdown, Spinner, notifyError } from "../../ui";
import { BriefCardView } from "../home/BriefCards";

/** The brief's card for one project, for any range; by default since the owner last worked on it. */
export function CatchMeUp({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [range, setRange] = useState<BriefRange | "">("");
  const [result, setResult] = useState<{ since: string; card: BriefCard } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = `${projectId}:${range}`;
  const busy = done !== key;
  useEffect(() => {
    let current = true;
    void office.invoke("brief.catchUp", { projectId, ...(range ? { range } : {}) })
      .then((value) => { if (current) setResult(value); })
      .catch((error: unknown) => { if (current) notifyError(error, "Could not catch you up", `catch-${projectId}`); })
      .finally(() => { if (current) setDone(key); });
    return () => { current = false; };
  }, [projectId, range, key]);
  return (
    <Dialog title="Catch me up" wide onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="grid gap-3" data-testid="catch-me-up">
        <label className="grid gap-1">
          <span className="ui-label">Cover</span>
          <Dropdown aria-label="Cover" value={range} onChange={(event) => setRange(event.target.value === "" ? "" : BriefRange.parse(event.target.value))}>
            <option value="">Since I last worked on it</option>
            {BriefRange.options.map((option) => <option key={option} value={option}>{BRIEF_RANGE_LABELS[option]}</option>)}
          </Dropdown>
        </label>
        {busy && <p className="ui-muted" role="status"><Spinner /> Reading what changed</p>}
        {!busy && result && <>
          <p className="ui-muted m-0">Since {new Date(result.since).toLocaleDateString()}.</p>
          <BriefCardView card={result.card} />
        </>}
      </div>
    </Dialog>
  );
}
