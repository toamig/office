import { Archive, Play, Square } from "lucide-react";
import type { DockviewApi } from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRow } from "@shared/models";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { InspectorSlot } from "../components/Inspector";
import { AgentInspector } from "./agents/AgentInspector";
import { CaptureDialog } from "./agents/CaptureDialog";
import { PaneHeader } from "./agents/PaneHeader";
import { DiffTab } from "./git/DiffTab";
import { PreviewTab } from "./PreviewTab";
import { StartAgentDialog } from "./agents/StartAgentDialog";
import { SessionSurface } from "./agents/SessionSurface";
import { StatusChip } from "../components/StatusChip";
import { VirtualList } from "../components/VirtualList";
import {
  Banner,
  Button,
  Dropdown,
  EmptyState,
  IconButton,
  Page,
  SplitPane,
  Time,
  Workbench,
  notifyError,
  splitBeside,
  tabsTogether,
  type PanelComponent,
  type WorkbenchPreset,
} from "../ui";

function SessionList({
  sessions,
  active,
  onOpen,
  onChanged,
  onCloseSession,
}: {
  sessions: SessionRow[];
  active: string | null;
  onOpen: (s: SessionRow) => void;
  onChanged: () => void;
  onCloseSession: (s: SessionRow) => void;
}) {
  const projects = useQuery("projects.list");
  const name = (id: string | null): string => projects.data?.find((p) => p.id === id)?.name ?? "";
  return (
    <div className="flex h-full flex-col" data-testid="session-list">
      {sessions.length === 0 && (
        <EmptyState title="No sessions yet">Start an agent to begin.</EmptyState>
      )}
      <VirtualList
        items={sessions}
        estimate={58}
        itemKey={(s) => s.id}
        renderItem={(s) => (
          <div
            data-testid="session-row"
            onClick={() => onOpen(s)}
            onContextMenu={(e) => {
              e.preventDefault();
              void office
                .invoke("app.popupMenu", {
                  items: [
                    { id: "resume", label: "Resume", enabled: !s.running && s.mode !== "chat" },
                    { id: "stop", label: "Stop", enabled: s.running },
                    { id: "close", label: "Close and wrap up" },
                  ],
                })
                .then((choice) => {
                  if (choice === "resume")
                    void office.invoke("sessions.resume", { id: s.id }).then(onChanged);
                  else if (choice === "stop")
                    void office.invoke("sessions.kill", { id: s.id }).then(onChanged);
                  else if (choice === "close") onCloseSession(s);
                });
            }}
            className="session-row ui-row"
            data-selected={active === s.id ? "true" : undefined}
            data-clickable="true"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate font-medium">{s.title ?? s.provider}</span>
                <span data-testid="session-status">
                  <StatusChip status={s.status} />
                </span>
              </div>
              <div className="ui-line-sub mt-1 flex flex-wrap gap-x-3">
                {name(s.projectId) && <span>{name(s.projectId)}</span>}
                {s.branch && <span>{s.branch}</span>}
                {s.role && <span>Role: {s.role}</span>}
                <Time iso={s.updatedAt} />
              </div>
            </div>
            <div className="session-actions flex gap-0.5">
              {!s.running && s.mode !== "chat" && (
                <IconButton
                  size="sm"
                  label="Resume"
                  onClick={(e) => {
                    e.stopPropagation();
                    void office
                      .invoke("sessions.resume", { id: s.id })
                      .then(onChanged, (err: unknown) =>
                        notifyError(err, "Could not resume that session", s.id),
                      );
                  }}
                  data-testid="resume-session"
                >
                  <Play />
                </IconButton>
              )}
              {s.running && (
                <IconButton
                  size="sm"
                  label="Stop"
                  onClick={(e) => {
                    e.stopPropagation();
                    void office.invoke("sessions.kill", { id: s.id }).then(onChanged);
                  }}
                  data-testid="stop-session"
                >
                  <Square />
                </IconButton>
              )}
              <IconButton
                size="sm"
                label="Close and wrap up"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseSession(s);
                }}
                data-testid="close-session"
              >
                <Archive />
              </IconButton>
            </div>
          </div>
        )}
      />
    </div>
  );
}

/** One session as a panel of the dock: a chat or a terminal, kept mounted so moving it never restarts it. */
const SessionPanel: PanelComponent = ({ params }) => {
  const id = String(params["sessionId"] ?? "");
  const sessions = useQuery("sessions.list", {}, ["session.status"]);
  const session = sessions.data?.find((s) => s.id === id);
  if (!session)
    return (
      <EmptyState title="That session is gone">It was removed from the sessions list.</EmptyState>
    );
  return (
    <div className="agent-pane h-full" data-testid="pane">
      {session.mode !== "chat" && (
        <PaneHeader
          session={session}
          options={[]}
          split={false}
          onPick={() => undefined}
          onChanged={sessions.reload}
        />
      )}
      <div className="ui-panel-bg min-h-0 flex-1">
        <SessionSurface session={session} onChanged={sessions.reload} />
      </div>
    </div>
  );
};

/** The changes of the project the session works in, beside the conversation. */
const DiffPanel: PanelComponent = ({ params }) => (
  <div className="dock-panel">
    {params["projectId"] ? (
      <DiffTab projectId={String(params["projectId"])} />
    ) : (
      <EmptyState title="No project">This session is not in a project.</EmptyState>
    )}
  </div>
);

/** The project's preview, beside the conversation. */
const PreviewPanel: PanelComponent = ({ params }) => (
  <div className="dock-panel" data-flush="true">
    {params["projectId"] ? (
      <PreviewTab projectId={String(params["projectId"])} />
    ) : (
      <EmptyState title="No project">This session is not in a project.</EmptyState>
    )}
  </div>
);

const AGENT_COMPONENTS: Record<string, PanelComponent> = {
  session: SessionPanel,
  "agent-diff": DiffPanel,
  "agent-preview": PreviewPanel,
};

/**
 * Sessions on the left, and a dock on the right where each chat, terminal, diff and preview is a panel: tab them, split
 * them, drag them to dock, float them. The layout is saved per project, and a move never restarts a session.
 */
export function Agents({ active: visible }: { active: boolean }) {
  const params = useUi((s) => s.params);
  const visits = useUi((s) => s.visits);
  // The view stays alive when the owner leaves it (terminals and streams are never rebuilt), so a link that
  // arrives later is applied when the view is on screen and the visit is a new one.
  const [applied, setApplied] = useState<number | null>(null);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const scope = filter || "all";
  const sessions = useQuery("sessions.list", filter ? { projectId: filter } : {}, [
    "session.status",
  ]);
  const projects = useQuery("projects.list");
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState<SessionRow | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const api = useRef<DockviewApi | null>(null);
  const opened = useRef<string | null>(null);
  if (visible && applied !== visits) {
    setApplied(visits);
    // A plain click on Agents keeps the filter and the panels as they were; only a link with parameters sets them.
    if (Object.keys(params).length > 0) {
      setLinked(params);
      setFilter(params["project"] ?? "");
      setStarting(params["start"] === "1");
    }
  }

  const list = sessions.data ?? [];
  const byId = new Map(list.map((s) => [s.id, s]));

  /** Opens a session as a panel, or brings its panel forward when it is open already. */
  const open = useCallback((s: SessionRow): void => {
    const dock = api.current;
    if (!dock) return;
    const existing = dock.getPanel(s.id);
    if (existing) existing.api.setActive();
    else
      dock.addPanel({
        id: s.id,
        component: "session",
        title: s.title ?? s.provider,
        params: { sessionId: s.id, testId: "tab" },
        renderer: "always",
      });
  }, []);

  // A session named in a link opens once, as soon as the dock and the list are there.
  const wanted = linked["session"];
  const wantedSession = wanted ? byId.get(wanted) : undefined;
  useEffect(() => {
    if (wantedSession && api.current && opened.current !== wantedSession.id) {
      opened.current = wantedSession.id;
      open(wantedSession);
    }
  }, [wantedSession, open, scope]);
  // Tab titles follow the sessions' titles.
  useEffect(() => {
    for (const s of sessions.data ?? [])
      api.current?.getPanel(s.id)?.api.setTitle(s.title ?? s.provider);
  }, [sessions.data]);

  const activeSession = activeId ? byId.get(activeId) : undefined;
  /** Adds the diff and preview panels of the active session's project if they are not there. */
  const ensureReview = (dock: DockviewApi): void => {
    const projectId = activeSession?.projectId;
    if (!projectId) return;
    if (!dock.getPanel("agent-diff"))
      dock.addPanel({
        id: "agent-diff",
        component: "agent-diff",
        title: "Changes",
        params: { projectId, testId: "dock-tab" },
      });
    if (!dock.getPanel("agent-preview"))
      dock.addPanel({
        id: "agent-preview",
        component: "agent-preview",
        title: "Preview",
        params: { projectId, testId: "dock-tab" },
      });
  };
  const presets: WorkbenchPreset[] = [
    { id: "focus", label: "Focus: one panel at a time", apply: (dock) => tabsTogether(dock) },
    {
      id: "side",
      label: "Side by side",
      apply: (dock) => {
        tabsTogether(dock);
        const sessionsOpen = dock.panels.filter((p) => byId.has(p.id));
        const [first, second] = [
          activeId ?? sessionsOpen[0]?.id,
          sessionsOpen.find((p) => p.id !== activeId)?.id,
        ];
        if (first && second) splitBeside(dock, second, first);
      },
    },
    {
      id: "review",
      label: "Review: conversation, changes and preview",
      apply: (dock) => {
        ensureReview(dock);
        tabsTogether(dock);
        const left = activeId && dock.getPanel(activeId) ? activeId : dock.panels[0]?.id;
        if (left && dock.getPanel("agent-diff")) {
          splitBeside(dock, "agent-diff", left);
          if (dock.getPanel("agent-preview"))
            splitBeside(dock, "agent-preview", "agent-diff", "below");
        }
      },
    },
  ];

  return (
    <Page
      title="Agents"
      testId="agents"
      fill
      primary={
        <Button variant="primary" onClick={() => setStarting(true)} data-testid="start-agent-open">
          <Play /> Start agent
        </Button>
      }
    >
      <div className="flex flex-none items-center gap-2">
        <Dropdown
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Project filter"
        >
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Dropdown>
      </div>
      {sessions.error && <Banner tone="danger">{sessions.error}</Banner>}
      <SplitPane
        id="agents"
        defaultSize={320}
        min={240}
        minSecond={420}
        first={
          <SessionList
            sessions={list}
            active={activeId}
            onOpen={open}
            onChanged={sessions.reload}
            onCloseSession={setClosing}
          />
        }
        second={
          <Workbench
            key={scope}
            workbench="agents"
            scope={scope}
            components={AGENT_COMPONENTS}
            presets={presets}
            initial={() => undefined}
            onReady={(dock) => {
              api.current = dock;
              opened.current = null;
              // Whatever the saved layout had open, the sessions it names are still sessions.
              setActiveId(dock.activePanel?.id ?? null);
            }}
            onActive={(id) => {
              if (id && id !== "agent-diff" && id !== "agent-preview") setActiveId(id);
            }}
            empty={
              <EmptyState title="Nothing open">
                Open a session from the list, or start a new agent.
              </EmptyState>
            }
          />
        }
      />
      <InspectorSlot view="agents">
        <AgentInspector session={activeSession} />
      </InspectorSlot>
      {closing && (
        <CaptureDialog
          session={closing}
          onClose={() => {
            setClosing(null);
            sessions.reload();
          }}
        />
      )}
      {starting && (
        <StartAgentDialog
          {...(filter ? { projectId: filter } : {})}
          {...(linked["cwd"] ? { cwd: linked["cwd"] } : {})}
          {...(linked["role"] ? { roleId: linked["role"] } : {})}
          onClose={() => setStarting(false)}
          onStarted={(session) => {
            setStarting(false);
            sessions.reload();
            open(session);
          }}
        />
      )}
    </Page>
  );
}
