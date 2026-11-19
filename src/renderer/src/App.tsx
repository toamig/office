import { lazy, Suspense, useEffect, useState } from "react";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { Sidebar } from "./components/Sidebar";
import { SyncReportDialog } from "./components/SyncReportDialog";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { ThemeApplier } from "./components/ThemeApplier";
import { ViewBoundary } from "./components/ViewBoundary";
import { TopBar } from "./components/TopBar";
import { useQuery } from "./lib/hooks";
import { prefetchStart } from "./lib/prefetch";
import { LeaveGuard } from "./components/LeaveGuard";
import { SIDEBAR_COLLAPSED, useSidebarCollapsed, useSidebarWidth } from "./lib/sidebar";
import { useGlobalShortcuts } from "./lib/shortcuts";
import { Inspector } from "./components/Inspector";
import { useInspector } from "./lib/inspector";
import { office } from "./lib/ipc";
import { useUi, type ViewId } from "./stores/ui";
import { Agents } from "./views/Agents";
import { Board } from "./views/Board";
import { Brain } from "./views/Brain";
import { Explore } from "./views/Explore";
import { Git } from "./views/Git";
import { Home as HomeView } from "./views/Home";
import { Inbox } from "./views/Inbox";
import { ProjectPage } from "./views/ProjectPage";
import { Projects } from "./views/Projects";
import { Setup } from "./views/Setup";
import { Banner, NotificationStack, notify } from "./ui";
import { Welcome } from "./views/welcome/Welcome";

/** The views that are drawn fresh each time; the Agents view is kept alive by App and never comes through here. */
/** The Gallery exists in development and web builds only: in the packaged app this is null and its code is not in the bundle. */
const Gallery =
  import.meta.env.DEV || import.meta.env.VITE_GALLERY === "1"
    ? lazy(() => import("./views/Gallery").then((m) => ({ default: m.Gallery })))
    : null;

function CurrentView({ configured }: { configured: boolean }) {
  const picked = useUi((s) => s.view);
  const view = configured ? picked : "setup";
  const params = useUi((s) => s.params);
  if (view === "home") return <HomeView />;
  if (view === "projects") return <Projects />;
  if (view === "project") {
    return (
      <ProjectPage
        key={`${params["id"]}-${params["tab"] ?? ""}-${params["note"] ?? ""}-${params["section"] ?? ""}`}
        id={params["id"] ?? ""}
        {...(params["tab"] ? { tab: params["tab"] } : {})}
        {...(params["note"] ? { note: params["note"] } : {})}
        {...(params["section"] ? { section: params["section"] } : {})}
      />
    );
  }
  if (view === "git") return <Git key={params["project"] ?? ""} />;
  if (view === "board") return <Board key={params["task"] ?? ""} />;
  if (view === "brain") return <Brain />;
  if (view === "explore") return <Explore />;
  if (view === "inbox") return <Inbox />;
  if (view === "gallery" && Gallery)
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  return <Setup />;
}

export default function App() {
  const navigate = useUi((s) => s.navigate);
  const view = useUi((s) => s.view);
  const [collapsed, toggleSidebar] = useSidebarCollapsed();
  const { width: sidebarWidth } = useSidebarWidth();
  const [resizing, setResizing] = useState<number | null>(null);
  const inspector = useInspector(view);
  const [inspectorResizing, setInspectorResizing] = useState<number | null>(null);
  const inspectorWidth = inspectorResizing ?? inspector.width;
  useGlobalShortcuts(toggleSidebar, inspector.toggle);
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  // The Agents view is built the first time it is opened and then kept, hidden when the owner leaves it.
  const [agentsOpened, setAgentsOpened] = useState(false);
  if (view === "agents" && !agentsOpened) setAgentsOpened(true);
  const setup = useQuery("setup.state", undefined, [
    "setup.changed",
    "workspace.changed",
    "settings.changed",
  ]);
  useEffect(
    () =>
      office.on("app.navigate", (e) => {
        const link = e.payload as { view: ViewId; params?: Record<string, string> };
        navigate(link.view, link.params ?? {});
      }),
    [navigate],
  );
  // The first time the config is saved after the old per-role permissions became profiles, say what happened.
  useEffect(
    () =>
      office.on("profiles.migrated", (e) => {
        const m = e.payload as { total: number; matched: number; kept: number };
        notify({
          tone: "info",
          title: `Your ${m.total} ${m.total === 1 ? "role now uses" : "roles now use"} profiles`,
          detail: `${m.matched} match built-ins, ${m.kept} keep their own settings. See Board, Permissions.`,
          subject: "profiles-migrated",
        });
      }),
    [],
  );
  useEffect(() => {
    if (setup.data && !setup.data.welcome) prefetchStart();
  }, [setup.data]);
  // Until setup is done Office is only the welcome flow: no sidebar, no views (spec 4.8).
  if (setup.data?.welcome) {
    return (
      <>
        <Welcome state={setup.data} />
        <NotificationStack />
        <ThemeApplier />
      </>
    );
  }
  if (!setup.data) {
    return (
      <div className="app">
        <header className="topbar" />
        <ThemeApplier />
      </div>
    );
  }
  return (
    <div className="app">
      <TopBar />
      <div
        className="app-body"
        style={
          {
            "--sidebar-w": `${collapsed ? SIDEBAR_COLLAPSED : (resizing ?? sidebarWidth)}px`,
            "--inspector-w": `${inspector.open ? inspectorWidth : 0}px`,
          } as React.CSSProperties
        }
      >
        <Sidebar width={resizing ?? sidebarWidth} onResizing={setResizing} />
        <main className="app-main">
          {workspace.data?.error && (
            <div className="p-4 pb-0">
              <Banner tone="danger" testId="workspace-error">
                {workspace.data.error}
              </Banner>
            </div>
          )}
          {agentsOpened && (
            <div className="h-full" hidden={view !== "agents"} data-testid="agents-host">
              <ViewBoundary>
                <Agents active={view === "agents"} />
              </ViewBoundary>
            </div>
          )}
          {workspace.data && view !== "agents" && (
            <ViewBoundary key={view}>
              <CurrentView configured={workspace.data.configured} />
            </ViewBoundary>
          )}
        </main>
        <Inspector view={view} width={inspectorWidth} onResizing={setInspectorResizing} />
      </div>
      <SyncReportDialog />
      <QuickSwitcher />
      <ShortcutsSheet />
      <LeaveGuard />
      <NotificationStack />
      <ThemeApplier />
    </div>
  );
}
