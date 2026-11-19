import { ChevronDown, MoreHorizontal } from "lucide-react";
import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton } from "./Button";

/** The spot in a page header where a view's own controls go (a workbench puts its Layout menu there). */
export const PageActionsContext = createContext<HTMLElement | null>(null);

export interface MoreItem {
  label: string;
  onSelect: () => void;
  /** A destructive action: set apart from the rest and shown in the danger colour. */
  danger?: boolean;
  testId?: string;
}

/** The overflow menu of a page header: secondary actions, with the destructive ones set apart at the end. */
export function OverflowMenu({
  items,
  label = "More actions",
  trigger,
  testId = "page-more",
}: {
  items: MoreItem[];
  label?: string;
  /** A word for the button, instead of the three dots. */
  trigger?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const calm = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const row = (i: MoreItem): ReactNode => (
    <button
      key={i.label}
      type="button"
      role="menuitem"
      className="ui-menu-item"
      data-danger={i.danger ? "true" : undefined}
      data-testid={i.testId}
      onClick={() => {
        setOpen(false);
        i.onSelect();
      }}
    >
      {i.label}
    </button>
  );
  return (
    <div className="ui-menu-host" ref={box}>
      {trigger ? (
        <Button
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid={testId}
        >
          {trigger} <ChevronDown />
        </Button>
      ) : (
        <IconButton
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid={testId}
        >
          <MoreHorizontal />
        </IconButton>
      )}
      {open && (
        <div className="ui-popover ui-menu" role="menu" data-testid={`${testId}-menu`}>
          {calm.map(row)}
          {danger.length > 0 && calm.length > 0 && (
            <div className="ui-menu-rule" role="separator" />
          )}
          {danger.map(row)}
        </div>
      )}
    </div>
  );
}

/**
 * The header every view has: a title (with a breadcrumb inside a project), the one primary action on the right,
 * and the secondary actions in an overflow menu.
 */
export function PageHeader({
  title,
  breadcrumb,
  subtitle,
  primary,
  more,
  testId,
  actionsRef,
}: {
  title: string;
  breadcrumb?: Array<{ label: string; onClick?: () => void }>;
  subtitle?: ReactNode;
  primary?: ReactNode;
  more?: MoreItem[];
  testId?: string;
  actionsRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <header className="page-head" data-testid={testId ?? "page-header"}>
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="page-crumbs">
            {breadcrumb.map((c, i) => (
              <span key={`${c.label}-${i}`}>
                {c.onClick ? (
                  <button type="button" className="page-crumb" onClick={c.onClick}>
                    {c.label}
                  </button>
                ) : (
                  c.label
                )}
                <span aria-hidden> / </span>
              </span>
            ))}
          </nav>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      <div className="page-actions">
        <span className="contents" ref={actionsRef} />
        {primary}
        {more && more.length > 0 && <OverflowMenu items={more} />}
      </div>
    </header>
  );
}

/** A view's page: the header, then the content, which uses the whole width. `fill` makes the content fill the height (split panes). */
export function Page({
  fill = false,
  children,
  testId,
  ...header
}: Parameters<typeof PageHeader>[0] & { fill?: boolean; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="page" data-fill={fill ? "true" : undefined} data-testid={testId}>
      <PageHeader {...header} actionsRef={setSlot} />
      <PageActionsContext.Provider value={slot}>
        <div className="page-body">{children}</div>
      </PageActionsContext.Provider>
    </div>
  );
}

/** A grid of cards that fills the width: as many columns as fit at 280 px each. */
export function CardGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="ui-grid" data-testid={testId}>
      {children}
    </div>
  );
}
