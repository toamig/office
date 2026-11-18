import {
  Bot,
  Brain,
  Compass,
  FolderKanban,
  GitBranch,
  Home,
  Inbox as InboxIcon,
  KanbanSquare,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { useEffect, type ComponentType } from "react";
import { SyncReportDialog } from "./components/SyncReportDialog";
import { Button } from "./components/ui";
import { office } from "./lib/ipc";
import { useUi, type ViewId } from "./stores/ui";
import { useQuery } from "./lib/hooks";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { Home as HomeView } from "./views/Home";
import { Inbox } from "./views/Inbox";
import { ProjectPage } from "./views/ProjectPage";
import { Projects } from "./views/Projects";
import { Placeholder } from "./views/Placeholder";

const rail: Array<{ id: ViewId; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "brain", label: "Brain", icon: Brain },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "setup", label: "Setup", icon: Settings },
];

function CurrentView() {
  const view = useUi((s) => s.view);
  const params = useUi((s) => s.params);
  if (view === "home") return <HomeView />;
  if (view === "projects") return <Projects />;
  if (view === "project") {
    return (
      <ProjectPage
        key={`${params["id"]}-${params["tab"] ?? ""}-${params["note"] ?? ""}`}
        id={params["id"] ?? ""}
        {...(params["tab"] ? { tab: params["tab"] } : {})}
        {...(params["note"] ? { note: params["note"] } : {})}
      />
    );
  }
  if (view === "inbox") return <Inbox />;
  const item = rail.find((r) => r.id === view);
  return <Placeholder title={item?.label ?? view} note="Coming in a later task." />;
}

function TopBar() {
  const { syncing, setSyncing, setSyncReport, setSwitcherOpen } = useUi();
  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      setSyncReport(await office.invoke("git.syncAll"));
    } finally {
      setSyncing(false);
    }
  };
  return (
    <header
      className="flex h-10 items-center gap-2 border-b px-3"
      style={{ background: "var(--panel)", borderColor: "var(--line)" }}
    >
      <button
        className="flex w-72 cursor-pointer items-center gap-2 rounded border px-2 py-1 text-left"
        style={{ borderColor: "var(--line)", color: "var(--muted)", background: "var(--bg)" }}
        onClick={() => setSwitcherOpen(true)}
        data-testid="switcher-button"
      >
        <Search size={14} /> Jump to anything
        <kbd className="ml-auto text-[11px]">Ctrl+K</kbd>
      </button>
      <div className="flex-1" />
      <Button onClick={() => void sync()} disabled={syncing} data-testid="sync-all">
        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
        {syncing ? "Syncing..." : "Sync all"}
      </Button>
    </header>
  );
}

export default function App() {
  const { view, navigate } = useUi();
  const counts = useQuery("notifications.counts", undefined, [
    "notification.new",
    "notification.read",
  ]);
  useEffect(
    () =>
      office.on("app.navigate", (e) => {
        const link = e.payload as { view: ViewId; params?: Record<string, string> };
        navigate(link.view, link.params ?? {});
      }),
    [navigate],
  );
  return (
    <div className="flex h-full">
      <nav
        data-testid="rail"
        className="flex w-44 flex-col gap-0.5 border-r p-2"
        style={{ background: "var(--rail)", borderColor: "var(--line)" }}
      >
        <div className="px-2 pb-2 pt-1 text-sm font-semibold">Office</div>
        {rail.map((v) => (
          <button
            key={v.id}
            onClick={() => navigate(v.id)}
            data-testid={`rail-${v.id}`}
            className="flex cursor-pointer items-center gap-2 rounded border-0 px-2 py-1.5 text-left"
            style={{
              background: view === v.id ? "var(--panel)" : "transparent",
              color: "var(--text)",
              fontWeight: view === v.id ? 600 : 400,
            }}
          >
            <v.icon size={16} />
            {v.label}
            {v.id === "inbox" && (counts.data?.unread ?? 0) > 0 && (
              <span
                data-testid="inbox-count"
                className="ml-auto rounded-full px-1.5 text-[11px] text-white"
                style={{ background: "var(--accent)" }}
              >
                {counts.data?.unread}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">
          <CurrentView />
        </main>
      </div>
      <SyncReportDialog />
      <QuickSwitcher />
    </div>
  );
}
