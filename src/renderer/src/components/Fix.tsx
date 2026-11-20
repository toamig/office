import { ExternalLink, Wrench } from "lucide-react";
import type { FixEntry, FixSubject } from "@shared/models";
import { useFix } from "../lib/fix";
import { useUi } from "../stores/ui";
import { Button, type MoreItem } from "../ui";

/** "Being fixed in <session>" with Open, shown where the Fix in a session button would be. */
export function BeingFixed({ entry }: { entry: FixEntry }) {
  const navigate = useUi((s) => s.navigate);
  return (
    <span className="inline-flex items-center gap-2" data-testid="fix-being">
      <span className="ui-muted">Being fixed in {entry.title}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => navigate("agents", { session: entry.sessionId })}
        data-testid="fix-open"
      >
        <ExternalLink /> Open
      </Button>
    </span>
  );
}

/**
 * One shared action for a problem that has no safe fix of its own: starts a chat at once, in the folder where the
 * problem lives, with everything Office knows as its first message. While a session fixes it, this shows that
 * instead of a second button.
 */
export function FixButton({
  subject,
  variant = "secondary",
  onStart,
}: {
  subject: FixSubject;
  variant?: "secondary" | "primary" | "ghost";
  /** Called when the click starts the session, for a popover that should close. */
  onStart?: () => void;
}) {
  const fix = useFix(subject);
  if (fix.entry) return <BeingFixed entry={fix.entry} />;
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={fix.busy}
      onClick={() => {
        onStart?.();
        fix.start();
      }}
      data-testid="fix-start"
    >
      <Wrench /> {fix.busy ? "Starting..." : "Fix in a session"}
    </Button>
  );
}

/** The Fix in a session entry of an item's menu, for an item whose main button is one of Office's own fixes. */
export function useFixMenuItem(subject: FixSubject): { item: MoreItem | null; entry?: FixEntry } {
  const fix = useFix(subject);
  if (fix.entry) return { item: null, entry: fix.entry };
  return {
    item: {
      label: fix.busy ? "Starting..." : "Fix in a session",
      hint: "A chat that asks before it acts",
      testId: "fix-start",
      onSelect: fix.start,
    },
  };
}
