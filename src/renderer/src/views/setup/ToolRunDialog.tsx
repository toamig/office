import { useEffect, useRef, useState } from "react";
import type { SessionRow, ToolStatus } from "@shared/models";
import { Button, Dialog } from "../../ui";
import { office } from "../../lib/ipc";
import { firstUrl } from "../../lib/output";
import { TerminalView } from "../agents/TerminalView";

export interface ToolRun {
  session: SessionRow;
  /** "login" signs a tool in; "run" runs a command that fixes it (an install or an update). */
  kind: "login" | "run";
  toolId: string;
  toolLabel: string;
  /** Starts the same thing again (Retry). */
  again: () => void;
}

type Phase = "running" | "checking" | "done" | "failed";

/** Whether the tool is in the state the run was for. */
function fixed(run: ToolRun, tools: ToolStatus[]): boolean {
  const tool = tools.find((t) => t.id === run.toolId);
  if (!tool?.installed) return false;
  return run.kind === "login" ? tool.loggedIn === true : !tool.problem;
}

/**
 * Logging a tool in, or running a command that fixes it, in a dialog of its own over the whole window. It says in plain
 * words what is happening, keeps the program's raw output under Details (where a code can be typed if the program asks
 * for one), checks the tool when the program ends, closes by itself on success and stays open with Retry on failure.
 */
export function ToolRunDialog({ run, onClose, onSuccess }: { run: ToolRun; onClose: () => void; onSuccess?: () => void }) {
  const [phase, setPhase] = useState<Phase>("running");
  const [url, setUrl] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const finished = useRef(false);
  const { session, kind, toolLabel } = run;

  const close = (): void => {
    void office.invoke("sessions.kill", { id: session.id }).catch(() => undefined);
    void office.invoke("sessions.archive", { id: session.id }).catch(() => undefined);
    onClose();
  };

  // While the program runs, watch its output for the sign-in address.
  useEffect(() => {
    if (phase !== "running") return;
    const look = (): void => {
      void office.invoke("sessions.history", { id: session.id }).then((h) => {
        const found = firstUrl(h.data);
        if (found) setUrl(found);
      });
    };
    look();
    const timer = setInterval(look, 800);
    return () => clearInterval(timer);
  }, [phase, session.id]);

  // When the program ends, look at the tool again: that, not the exit code alone, says whether it worked.
  useEffect(() => {
    const check = (status?: string) => {
      if (finished.current || (status !== "exited" && status !== "failed")) return;
      finished.current = true;
      setPhase("checking");
      const verified = run.kind === "login"
        ? office.invoke("setup.verifyLogin", { id: run.toolId })
        : office.invoke("setup.recheckTools").then((tools) => fixed(run, tools));
      void verified.then(
        (ok) => setPhase(status === "exited" && ok ? "done" : "failed"),
        () => setPhase("failed"),
      );
    };
    const off = office.on("session.status", (e) => {
        const payload = e.payload as { id?: string; status?: string };
        if (payload.id === session.id) check(payload.status);
    });
    void office.invoke("sessions.get", { id: session.id }).then((row) => check(row.status), () => undefined);
    return off;
  }, [run, session.id]);

  // Success closes the dialog by itself, after a moment to read it.
  useEffect(() => {
    if (phase !== "done") return;
    const timer = setTimeout(() => { close(); onSuccess?.(); }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const lead =
    phase === "done"
      ? kind === "login"
        ? `Logged in to ${toolLabel}.`
        : `${toolLabel} is fixed.`
      : phase === "failed"
        ? kind === "login"
          ? "That did not work. Try again, or open Details to see what the program said."
          : "That did not work. Try again, or open Details to see what the program said."
        : phase === "checking"
          ? `Checking ${toolLabel}...`
          : kind === "login"
            ? "A browser window opened to sign in. Finish there, then come back."
            : "Running the command. This can take a minute.";

  return (
    <Dialog
      title={session.title ?? toolLabel}
      testId="tool-dialog"
      attrs={{ "data-phase": phase }}
      wide
      onClose={close}
      footer={
        <>
          {phase === "failed" && (
            <Button
              variant="primary"
              onClick={() => {
                close();
                run.again();
              }}
              data-testid="tool-dialog-retry"
            >
              Retry
            </Button>
          )}
          <Button onClick={close} data-testid="tool-dialog-close">
            {phase === "done" ? "Close" : phase === "running" ? "Cancel" : "Close"}
          </Button>
        </>
      }
    >
      <p className="m-0" data-testid="tool-dialog-lead">
        {lead}
      </p>
      {kind === "login" && url && phase === "running" && (
        <div className="mt-3">
          <Button
            onClick={() => window.open(url, "_blank", "noopener")}
            data-testid="tool-dialog-open-url"
          >
            Open the sign-in page again
          </Button>
        </div>
      )}
      <div className="mt-3">
        <Button
          variant="ghost"
          onClick={() => setDetails((v) => !v)}
          aria-expanded={details}
          data-testid="tool-dialog-details"
        >
          {details ? "Hide details" : "Details"}
        </Button>
        {details && (
          <div className="mt-2" data-testid="tool-terminal">
            <div className="ui-helper mb-1">
              What the program printed. If it asks for a code, click here and type it.
            </div>
            <div className="ui-surface" style={{ height: 240 }}>
              <TerminalView id={session.id} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
