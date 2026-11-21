import { Archive, Play, Square } from "lucide-react";
import type { DockviewApi } from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRow } from "@shared/models";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { InspectorSlot } from "../components/Inspector";
import { SessionActionsContext, useSessionActions } from "../components/SessionActions";
import { AgentInspector } from "./agents/AgentInspector";
import { WrapUpDialog } from "./agents/WrapUpDialog";
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
  Group,
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
  const name = (id: string | null): string =>
    projects.data?.find((p) => p.id === id)?.name ?? "No project";
  // Grouped by project, in the order each project's newest session appears, so what is live stays on top.
  const groups = new Map<string, SessionRow[]>();
  for (const s of sessions)
    groups.set(name(s.projectId), [...(groups.get(name(s.projectId)) ?? []), s]);
  const rows: Array<{ group: string } | { session: SessionRow }> = [...groups].flatMap(
    ([group, list]) => [{ group }, ...list.map((session) => ({ session }))],
  );
  const menu = (s: SessionRow): void => {
    void office
      .invoke("app.popupMenu", {
        items: [
          { id: "resume", label: "Resume", enabled: !s.running && s.mode !== "chat" },
          { id: "stop", label: "Stop", enabled: s.running },
          { id: "close", label: "Wrap up" },
        ],
      })
      .then((choice) => {
        if (choice === "resume")
          void office.invoke("sessions.resume", { id: s.id }).then(onChanged);
        else if (choice === "stop")
          void office.invoke("sessions.kill", { id: s.id }).then(onChanged);
        else if (choice === "close") onCloseSession(s);
      });
  };
  return (
    <div className="flex h-full flex-col" data-testid="session-list">
      {sessions.length === 0 && (
        <EmptyState title="No sessions yet">Start a session to begin.</EmptyState>
      )}
      <VirtualList
        items={rows}
        estimate={58}
        itemKey={(r) => ("group" in r ? `group:${r.group}` : r.session.id)}
        renderItem={(r) => {
          if ("group" in r)
            return (
              <div className="px-3 pt-3" data-testid="session-group">
                <Group>{r.group}</Group>
              </div>
            );
          const s = r.session;
          return (
            <div
              data-testid="session-row"
              onClick={() => onOpen(s)}
              onContextMenu={(e) => {
                e.preventDefault();
                menu(s);
              }}
              className="session-row ui-row"
              data-selected={active === s.id ? "true" : undefined}
              data-clickable="true"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium" data-testid="session-goal">
                    {s.title ?? s.provider}
                  </span>
                  <span data-testid="session-status">
                    <StatusChip status={s.status} />
                  </span>
                </div>
                <div className="ui-line-sub mt-1 flex flex-wrap gap-x-3">
                  <Time iso={s.updatedAt} />
                  {s.idle && <span data-testid="session-idle">Still needed?</span>}
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
                  label="Wrap up"
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
          );
        }}
      />
    </div>
  );
}

/** "Still needed?": asked once the session has sat unused for the idle time; Keep starts the time again. */
function IdlePrompt({ session, onChanged }: { session: SessionRow; onChanged: () => void }) {
  const { wrapUp } = useSessionActions();
  return (
    <Banner tone="attention" testId="idle-prompt">
      <span className="flex flex-wrap items-center gap-3">
        <span>Still needed? Nothing has happened here for a while.</span>
        <Button size="sm" onClick={() => wrapUp(session)} data-testid="idle-wrap-up">
          Wrap up
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void office
              .invoke("sessions.keep", { id: session.id })
              .then(onChanged, (err: unknown) =>
                notifyError(err, "Could not keep that session", session.id),
              )
          }
          data-testid="idle-keep"
        >
          Keep
        </Button>
      </span>
    </Banner>
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
      {session.idle && <IdlePrompt session={session} onChanged={sessions.reload} />}
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
  const settings = useQuery("settings.get", undefined, ["settings.changed"]);
  /** Off by default: Sessions shows one session at a time. */
  const multi = settings.data?.sessionsMulti ?? false;
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState<SessionRow | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const api = useRef<DockviewApi | null>(null);
  const opened = useRef<string | null>(null);
  const multiRef = useRef(false);
  useEffect(() => {
    multiRef.current = multi;
  }, [multi]);
  /** A session the owner asked to open before the dock had loaded its saved layout. */
  const pendingOpen = useRef<SessionRow | null>(null);
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
    if (!dock) {
      pendingOpen.current = s;
      return;
    }
    const existing = dock.getPanel(s.id);
    // One at a time: the session that was showing makes way (it keeps running; it is only closed as a panel).
    if (!multiRef.current)
      for (const p of [...dock.panels])
        if (p.id !== s.id && p.id !== "agent-diff" && p.id !== "agent-preview") p.api.close();
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
  const ensureReview = (dock: DockviewApi, only?: string): void => {
    const projectId = activeSession?.projectId;
    if (!projectId) return;
    if (only !== "agent-preview" && !dock.getPanel("agent-diff"))
      dock.addPanel({
        id: "agent-diff",
        component: "agent-diff",
        title: "Changes",
        params: { projectId, testId: "dock-tab" },
      });
    if (only !== "agent-diff" && !dock.getPanel("agent-preview"))
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
      title="Sessions"
      subtitle="Agent conversations working on your projects."
      testId="agents"
      fill
      primary={
        <Button variant="primary" onClick={() => setStarting(true)} data-testid="start-agent-open">
          <Play /> Start a session
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
      <SessionActionsContext.Provider value={{ wrapUp: setClosing }}>
        {sessions.error && <Banner tone="danger">{sessions.error}</Banner>}
        <SplitPane
          id="agents"
          defaultSize={280}
          min={220}
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
              groupActions={multi}
              catalog={[
                {
                  id: "agent-diff",
                  title: "Changes",
                  add: (dock) => ensureReview(dock, "agent-diff"),
                },
                {
                  id: "agent-preview",
                  title: "Preview",
                  add: (dock) => ensureReview(dock, "agent-preview"),
                },
              ]}
              layoutItems={[
                {
                  label: "Show several sessions at once",
                  hint: "Off, Sessions shows one session at a time",
                  checked: multi,
                  testId: "sessions-multi",
                  onSelect: () => void office.invoke("settings.set", { sessionsMulti: !multi }),
                },
              ]}
              initial={() => undefined}
              onReady={(dock) => {
                api.current = dock;
                opened.current = null;
                if (pendingOpen.current) {
                  const waiting = pendingOpen.current;
                  pendingOpen.current = null;
                  open(waiting);
                }
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
      </SessionActionsContext.Provider>
      <InspectorSlot view="agents">
        <AgentInspector session={activeSession} />
      </InspectorSlot>
      {closing && (
        <WrapUpDialog
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
          {...(linked["goal"] ? { goal: linked["goal"] } : {})}
          {...(linked["prompt"] ? { prompt: linked["prompt"] } : {})}
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
