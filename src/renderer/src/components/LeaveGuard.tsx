import { useEffect } from "react";
import { useUi } from "../stores/ui";
import { Button, Dialog } from "../ui";

/**
 * Registers a change that is not saved yet while the message is set: the window asks before it closes, and a move to
 * another page asks first (LeaveGuard shows the question). Clears itself when the message goes or the page does.
 */
export function useUnsaved(key: string, message: string | null): void {
  const set = useUi((s) => s.setUnsaved);
  useEffect(() => {
    set(key, message);
    return () => set(key, null);
  }, [key, message, set]);
  useEffect(() => {
    if (!message) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [message]);
}

/** The question a move away from unsaved changes brings up: stay and save, or leave and lose them. */
export function LeaveGuard() {
  const pending = useUi((s) => s.pendingLeave);
  const unsaved = useUi((s) => s.unsaved);
  const stay = useUi((s) => s.stayHere);
  const leave = useUi((s) => s.leaveAnyway);
  if (!pending) return null;
  return (
    <Dialog
      title="You have changes that are not saved"
      testId="leave-guard"
      onClose={stay}
      footer={
        <>
          <Button onClick={leave} data-testid="leave-anyway">
            Leave without saving
          </Button>
          <Button variant="primary" onClick={stay} data-testid="leave-stay">
            Stay and save
          </Button>
        </>
      }
    >
      {Object.values(unsaved).map((m) => (
        <p key={m} className="mb-2 mt-0">
          {m}
        </p>
      ))}
    </Dialog>
  );
}
