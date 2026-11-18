import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" }) {
  const base =
    "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[13px] disabled:opacity-50";
  const styles = {
    default: "border-[var(--line)] bg-[var(--panel)] hover:bg-[var(--hover)]",
    primary: "border-transparent bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90",
    ghost: "border-transparent hover:bg-[var(--hover)]",
  }[variant];
  // An icon-only button gets its label as a tooltip too.
  const tip = props.title ?? props["aria-label"];
  return (
    <button
      className={`${base} ${styles} ${className}`}
      {...props}
      {...(tip ? { title: tip } : {})}
    />
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const color = {
    neutral: "var(--muted)",
    good: "var(--good)",
    warn: "var(--warn)",
    bad: "var(--bad)",
  }[tone];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-px text-[11.5px]"
      style={{ color, borderColor: color }}
    >
      {children}
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
    <section
      className="rounded border"
      style={{ background: "var(--panel)", borderColor: "var(--line)" }}
    >
      {title && (
        <header
          className="flex items-center justify-between border-b px-3 py-2"
          style={{ borderColor: "var(--line)" }}
        >
          <h2 className="m-0 text-[13px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 py-4 text-center" style={{ color: "var(--muted)" }}>
      {children}
    </p>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded border px-3 py-2"
      style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
    >
      {message}
    </div>
  );
}
