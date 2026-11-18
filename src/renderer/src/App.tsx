import { useEffect } from "react";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { Sidebar } from "./components/Sidebar";
import { SyncReportDialog } from "./components/SyncReportDialog";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { ThemeApplier } from "./components/ThemeApplier";
import { ViewBoundary } from "./components/ViewBoundary";
import { TopBar } from "./components/TopBar";
import { ErrorBanner } from "./components/ui";
import { useQuery } from "./lib/hooks";
import { useSidebarCollapsed } from "./lib/sidebar";
import { useGlobalShortcuts } from "./lib/shortcuts";
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
import { Welcome } from "./views/welcome/Welcome";

function CurrentView({ configured }: { configured: boolean }) {
  const picked = useUi((s) => s.view);
  const view = configured ? picked : "setup";
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
  if (view === "agents")
    return (
      <Agents
        key={`${params["project"] ?? ""}-${params["session"] ?? ""}-${params["start"] ?? ""}-${params["cwd"] ?? ""}`}
      />
    );
  if (view === "git") return <Git key={params["project"] ?? ""} />;
  if (view === "board") return <Board key={params["task"] ?? ""} />;
  if (view === "brain") return <Brain />;
  if (view === "explore") return <Explore />;
  if (view === "inbox") return <Inbox />;
  return <Setup />;
}

export default function App() {
  const navigate = useUi((s) => s.navigate);
  const view = useUi((s) => s.view);
  const [, toggleSidebar] = useSidebarCollapsed();
  useGlobalShortcuts(toggleSidebar);
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
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
  // Until setup is done Office is only the welcome flow: no sidebar, no views (spec 4.8).
  if (setup.data?.welcome) {
    return (
      <>
        <Welcome state={setup.data} />
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
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          {workspace.data?.error && (
            <div className="p-3" data-testid="workspace-error">
              <ErrorBanner message={workspace.data.error} />
            </div>
          )}
          {workspace.data && (
            <ViewBoundary key={view}>
              <CurrentView configured={workspace.data.configured} />
            </ViewBoundary>
          )}
        </main>
      </div>
      <SyncReportDialog />
      <QuickSwitcher />
      <ShortcutsSheet />
      <ThemeApplier />
    </div>
  );
}
