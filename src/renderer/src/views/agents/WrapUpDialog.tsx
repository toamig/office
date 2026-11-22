import { useEffect, useRef, useState } from "react";
import type { SessionRow, WrapUpResult } from "@shared/models";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { Banner, Button, Dialog } from "../../ui";

export function WrapUpDialog({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const [result, setResult] = useState<WrapUpResult>();
  const [failure, setFailure] = useState<string>();
  const request = useRef<Promise<WrapUpResult> | null>(null);
  const navigate = useUi((state) => state.navigate);

  useEffect(() => {
    let active = true;
    request.current ??= office.invoke("sessions.wrapUp", { id: session.id });
    void request.current.then(
      (value) => { if (active) setResult(value); },
      (error: Error) => { if (active) setFailure(error.message); },
    );
    return () => { active = false; };
  }, [session.id]);

  const done = Boolean(result || failure);
  return (
    <Dialog
      title={done ? "Session wrap-up" : "Wrapping up"}
      onClose={done ? onClose : () => undefined}
      footer={done && (
        <>
          {Boolean(result?.proposed) && (
            <Button onClick={() => { onClose(); navigate("inbox"); }}>Open Needs you</Button>
          )}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      )}
    >
      {!done && <p className="m-0">Ending the session and recording what matters...</p>}
      {failure && <Banner tone="danger">{failure}</Banner>}
      {result?.error && <Banner tone="danger">Session ended. The recorder reported {result.error}</Banner>}
      {result?.stopped && <p>Session ended. The recorder was stopped.</p>}
      {result && !result.error && !result.stopped && (
        <div>
          <p className="mt-0">{result.saved ? `Saved ${result.saved} ${result.saved === 1 ? "note" : "notes"} to Brain.` : "No new notes were saved."}</p>
          {result.proposed > 0 && <p className="mb-0">{result.proposed} {result.proposed === 1 ? "proposal is" : "proposals are"} in Needs you.</p>}
        </div>
      )}
    </Dialog>
  );
}
