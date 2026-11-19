import type { ButtonHTMLAttributes, ReactNode } from "react";
import { timeAgo } from "../lib/hooks";

/** A button that reads as a link: for a name that opens the thing it names. */
export function LinkButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`ui-link ${className}`} {...props} />;
}

/** A group heading inside a card or list: sentence case, never capitals. */
export function Group({ children }: { children: ReactNode }) {
  return <h3 className="ui-group">{children}</h3>;
}

/** A time as a short relative phrase, with the full time on hover. */
export function Time({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="ui-muted">never</span>;
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={date.toLocaleString()} className="num">
      {timeAgo(iso)}
    </time>
  );
}

/** A path shortened from the left, with the whole path on hover. */
export function ShortPath({ path, keep = 3 }: { path: string; keep?: number }) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const text = parts.length > keep ? `.../${parts.slice(-keep).join("/")}` : path;
  return (
    <code className="ui-path" title={path}>
      {text}
    </code>
  );
}

/** A line of secondary text. */
export function Muted({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`ui-muted ${className}`}>{children}</span>;
}
