/**
 * The old shared pieces, now drawn by the design system (src/renderer/src/ui). New code imports from "../ui"
 * directly; these stay so that a view can be moved over one at a time.
 */
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { Banner, Button as UiButton, Card, notifyError } from "../ui";

export function Button({
  variant = "secondary",
  ...props
}: Omit<ComponentProps<typeof UiButton>, "variant"> & {
  variant?: "default" | "secondary" | "primary" | "ghost" | "danger";
}) {
  const tip = props.title ?? props["aria-label"];
  return (
    <UiButton
      variant={variant === "default" ? "secondary" : variant}
      {...props}
      {...(tip ? { title: tip } : {})}
    />
  );
}

/** A small tinted label. A status should use StatusBadge; this is for a plain label that has a tone. */
export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const t = { neutral: "neutral", good: "success", warn: "attention", bad: "danger" }[tone];
  return (
    <span className="ui-badge" data-tone={t}>
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card {...(title ? { title } : {})} {...(action ? { action } : {})}>
      {children}
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="ui-muted m-0 py-4">{children}</p>;
}

/**
 * An error from an action. It is shown as a notification, not as a bar in the page, so the layout never moves:
 * this draws nothing and raises one notification when the message appears.
 */
export function ErrorBanner({ message }: { message: string }) {
  useEffect(() => {
    if (message) notifyError(message, "That did not work", message);
  }, [message]);
  return null;
}

/** A lasting problem that stops the view from doing its job. */
export function ProblemBanner({ children }: { children: ReactNode }) {
  return <Banner tone="danger">{children}</Banner>;
}
