import { useEffect, useState } from "react";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Button, Dialog, Input, notifyError } from "../../ui";

export function ClaudeSignInDialog({ onClose }: { onClose: () => void }) {
  const status = useQuery("setup.claudeTokenStatus", undefined, ["setup.changed"]);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reload = status.reload;
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 750);
    return () => clearInterval(timer);
  }, [reload]);

  const close = () => {
    void office.invoke("setup.cancelClaudeToken").catch(() => undefined);
    onClose();
  };
  const submit = async () => {
    setSubmitting(true);
    try {
      await office.invoke("setup.submitClaudeCode", { code: code.trim() });
      setCode("");
    } catch (error) {
      notifyError(error, "Could not send the authorization code", "claude-sign-in");
      setSubmitting(false);
    }
  };
  const phase = status.data?.phase;
  const url = status.data?.url;
  return (
    <Dialog title="Stay signed in to Claude Code" onClose={close} footer={<Button onClick={close}>
      {phase === "saved" || phase === "failed" ? "Close" : "Cancel"}
    </Button>}>
      {phase === "saved" ? <p>Office saved your Claude Code sign-in.</p>
        : phase === "failed" ? <p>Claude Code did not finish signing in. Start again from Tools.</p>
          : <div className="grid justify-items-start gap-3">
            <p>Finish authorization in the browser. If the browser shows a code, paste it here.</p>
            {url && <>
              <Button onClick={() => window.open(url, "_blank", "noopener")}>Open the sign-in page</Button>
              <form className="grid w-full gap-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <Input label="Authorization code" type="password" autoComplete="off" spellCheck={false}
                  value={code} maxLength={2048} onChange={(event) => { setCode(event.target.value); setSubmitting(false); }} />
                <Button type="submit" variant="primary" disabled={!code.trim() || submitting}>Send code</Button>
              </form>
            </>}
          </div>}
    </Dialog>
  );
}
