import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A dialog: a header, a body that scrolls and a footer, over a scrim. Esc closes it, Tab stays inside it, and focus
 * goes to it when it opens and back to where it was when it closes. `sheet` is for long content.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
  sheet = false,
  testId,
  attrs,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  sheet?: boolean;
  testId?: string;
  /** Extra attributes for the scrim, such as a data-phase a test waits on. */
  attrs?: Record<string, string>;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="ui-scrim" data-testid={testId} {...attrs}>
      <div
        ref={box}
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-width={wide ? "wide" : undefined}
        data-sheet={sheet ? "true" : undefined}
      >
        <header className="ui-dialog-head">{title}</header>
        <div className="ui-dialog-body">{children}</div>
        {footer && <footer className="ui-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
