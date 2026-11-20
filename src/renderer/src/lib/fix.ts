import { useState } from "react";
import { fixKeyOf } from "@shared/fix";
import type { FixEntry, FixSubject } from "@shared/models";
import { notifyError } from "../ui";
import { useUi } from "../stores/ui";
import { office } from "./ipc";
import { useQuery } from "./query";

/** The problems that have a session fixing them right now. */
export function useFixes(): FixEntry[] {
  return useQuery("fix.list", undefined, ["fix.changed", "session.status"]).data ?? [];
}

/**
 * Starts a chat that fixes a problem and opens it. The chat is already running its first message when it opens: it
 * was started in the folder where the problem lives, asking before it acts.
 */
export function useStartFix(): (subject: FixSubject) => Promise<boolean> {
  const navigate = useUi((s) => s.navigate);
  return async (subject) => {
    try {
      const session = await office.invoke("fix.start", subject);
      navigate("agents", { session: session.id });
      return true;
    } catch (err) {
      notifyError(err, "Could not start a session to fix that", "fix");
      return false;
    }
  };
}

/** The state of one problem's Fix: whether a session already fixes it, and how to start one. */
export function useFix(subject: FixSubject): {
  entry: FixEntry | undefined;
  busy: boolean;
  start: () => void;
} {
  const fixes = useFixes();
  const startFix = useStartFix();
  const [busy, setBusy] = useState(false);
  const key = fixKeyOf(subject);
  return {
    entry: fixes.find((f) => f.key === key),
    busy,
    start: () => {
      setBusy(true);
      void startFix(subject).finally(() => setBusy(false));
    },
  };
}

/** The action of an error pop-up whose problem has a project or a folder: Fix in a session. */
export function fixAction(
  title: string,
  err: unknown,
  where: { projectId?: string; folder?: string },
): { label: string; run: () => void } {
  const cause = err instanceof Error ? err.message : String(err);
  return {
    label: "Fix in a session",
    run: () => {
      const { navigate } = useUi.getState();
      void office
        .invoke("fix.start", {
          type: "error",
          title,
          cause,
          ...(where.projectId ? { projectId: where.projectId } : {}),
          ...(where.folder ? { folder: where.folder } : {}),
        })
        .then((session) => navigate("agents", { session: session.id }))
        .catch((failure: unknown) =>
          notifyError(failure, "Could not start a session to fix that", "fix"),
        );
    },
  };
}
