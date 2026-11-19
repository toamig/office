import { ArrowLeft, ArrowRight, PanelLeft, PanelRight, RefreshCw, Search } from "lucide-react";
import { useInspector } from "../lib/inspector";
import { office } from "../lib/ipc";
import { useSidebarCollapsed } from "../lib/sidebar";
import { useUi } from "../stores/ui";
import { VIEW_LABELS } from "../lib/views";
import { Button, NotificationBell, notify, notifyError } from "../ui";

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
  const inspector = useInspector(view);
  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      const report = await office.invoke("git.syncAll");
      const bad = report.repos.filter((r) => r.action === "conflict" || r.action === "failed");
      const skipped = report.repos.filter((r) => r.action === "skipped");
      const moved = report.repos.filter((r) =>
        ["pulled", "pushed", "pulled-and-pushed"].includes(r.action),
      );
      const parts = [
        moved.length > 0 ? `${moved.length} updated` : "",
        skipped.length > 0 ? `${skipped.length} skipped` : "",
        bad.length > 0 ? `${bad.length} with a problem` : "",
      ].filter(Boolean);
      notify({
        tone: bad.length > 0 ? "danger" : skipped.length > 0 ? "attention" : "success",
        title: `Synced ${report.repos.length} ${report.repos.length === 1 ? "repo" : "repos"}`,
        detail: parts.length > 0 ? parts.join(", ") : "Everything was up to date",
        subject: "sync-all",
        action: { label: "View details", run: () => setSyncReport(report) },
      });
    } catch (err) {
      notifyError(err, "Sync all did not finish", "sync-all");
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
      {inspector.available && (
        <BarButton
          label={`${inspector.open ? "Hide" : "Show"} the details (Ctrl+Shift+B)`}
          onClick={inspector.toggle}
          testId="inspector-toggle"
        >
          <PanelRight size={16} />
        </BarButton>
      )}
      <NotificationBell />
      <Button onClick={() => void sync()} disabled={syncing} data-testid="sync-all">
        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
        {syncing ? "Syncing..." : "Sync all"}
      </Button>
    </header>
  );
}
