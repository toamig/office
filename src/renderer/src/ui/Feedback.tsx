import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@shared/tone";

/** A grey bar that stands in for text that is on its way; a width in characters. */
export function Skeleton({ width = 12 }: { width?: number }) {
  return <span className="ui-skeleton" style={{ width: `${width}ch` }} aria-hidden />;
}

/** A spinner for work that has no length of its own. */
export function Spinner({ label = "Working" }: { label?: string }) {
  return <Loader2 size={16} className="ui-spin" role="status" aria-label={label} />;
}

/** What this is, and one button for the next step. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <h3>{title}</h3>
      {children && <p className="m-0">{children}</p>}
      {action}
    </div>
  );
}

/**
 * A banner is for a lasting state: the view cannot do its job until something is fixed. It says what to do with
 * one button, and goes away when the state is fixed. Results of actions are notifications, not banners.
 */
export function Banner({
  tone = "attention",
  children,
  action,
  testId,
}: {
  tone?: Extract<Tone, "attention" | "danger" | "info">;
  children: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="ui-banner" data-tone={tone} role="status" data-testid={testId}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
