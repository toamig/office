import { ArrowLeft, ArrowRight, PanelLeft, RefreshCw, Search } from "lucide-react";
import { office } from "../lib/ipc";
import { useSidebarCollapsed } from "../lib/sidebar";
import { useUi } from "../stores/ui";
import { VIEW_LABELS } from "../lib/views";
import { Button } from "./ui";

/** The padding that keeps controls clear of the native window buttons drawn in the corner. */
const BUTTONS_CLEARANCE =
  "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))";

/** The icon-only button of the top bar. */
function BarButton({
  label,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className="bar-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/**
 * The window's own top bar. It is the drag region; every control in it opts out of dragging. The native
 * minimise, maximise and close buttons sit in the corner, so the bar leaves room for them.
 */
export function TopBar() {
  const { view, history, at, back, forward, syncing, setSyncing, setSyncReport, setSwitcherOpen } =
    useUi();
  const [, toggleSidebar] = useSidebarCollapsed();
  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      setSyncReport(await office.invoke("git.syncAll"));
    } finally {
      setSyncing(false);
    }
  };
  return (
    <header className="topbar" style={{ paddingRight: BUTTONS_CLEARANCE }} data-testid="topbar">
      <BarButton label="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar} testId="sidebar-toggle">
        <PanelLeft size={16} />
      </BarButton>
      <BarButton
        label="Previous view (Alt+Left)"
        onClick={back}
        disabled={at <= 0}
        testId="history-back"
      >
        <ArrowLeft size={16} />
      </BarButton>
      <BarButton
        label="Next view (Alt+Right)"
        onClick={forward}
        disabled={at >= history.length - 1}
        testId="history-forward"
      >
        <ArrowRight size={16} />
      </BarButton>
      <div className="topbar-title" data-testid="topbar-title">
        {VIEW_LABELS[view]}
      </div>
      <div className="flex-1" />
      <button
        className="switcher-button"
        onClick={() => setSwitcherOpen(true)}
        data-testid="switcher-button"
      >
        <Search size={14} /> Jump to anything
        <kbd>Ctrl+K</kbd>
      </button>
      <Button onClick={() => void sync()} disabled={syncing} data-testid="sync-all">
        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
        {syncing ? "Syncing..." : "Sync all"}
      </Button>
    </header>
  );
}
