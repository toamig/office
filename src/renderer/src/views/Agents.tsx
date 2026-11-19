import { Archive, LayoutGrid, Play, Rows2, Columns2, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Layout, SessionRow } from "@shared/models";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { CaptureDialog } from "./agents/CaptureDialog";
import { PaneHeader } from "./agents/PaneHeader";
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
  notifyError,
} from "../ui";

const EMPTY: Layout = { open: [], active: null, split: "single", panes: [] };
const CAPACITY: Record<Layout["split"], number> = { single: 1, columns: 2, rows: 2, grid: 4 };

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

/** Sessions on the left, terminals on the right in tabs with up to four panes; the layout is saved per project. */
export function Agents({ active: visible }: { active: boolean }) {
  const params = useUi((s) => s.params);
  const visits = useUi((s) => s.visits);
  // The view stays alive when the owner leaves it (terminals and streams are never rebuilt), so a link that
  // arrives later is applied when the view is on screen and the visit is a new one.
  const [applied, setApplied] = useState<number | null>(null);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const key = filter || "all";
  const sessions = useQuery("sessions.list", filter ? { projectId: filter } : {}, [
    "session.status",
  ]);
  const projects = useQuery("projects.list");
  const [saved, setLayout] = useState<Layout>(EMPTY);
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState<SessionRow | null>(null);
  if (visible && applied !== visits) {
    setApplied(visits);
    // A plain click on Agents keeps the filter and the tabs as they were; only a link with parameters sets them.
    if (Object.keys(params).length > 0) {
      setLinked(params);
      setFilter(params["project"] ?? "");
      setStarting(params["start"] === "1");
    }
  }

  // The saved layout is read once per key. A change the owner has already made is newer than what was saved,
  // so a late answer never replaces it.
  const changed = useRef(false);
  useEffect(() => {
    let alive = true;
    changed.current = false;
    void office.invoke("layout.get", { key }).then((loaded) => {
      if (!alive || changed.current) return;
      setLayout(loaded ?? EMPTY);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const update = (next: Layout): void => {
    changed.current = true;
    setLayout(next);
    void office.invoke("layout.set", { key, layout: next });
  };

  const list = sessions.data ?? [];
  const byId = new Map(list.map((s) => [s.id, s]));
  // A session named in the link opens as a tab even before the layout has it.
  const wanted = linked["session"];
  const layout: Layout =
    wanted !== undefined && byId.has(wanted) && !saved.open.includes(wanted)
      ? { ...saved, open: [...saved.open, wanted], active: wanted }
      : saved;
  const openIds = layout.open.filter((id) => byId.has(id));

  const open = (s: SessionRow): void => {
    update({
      ...layout,
      open: layout.open.includes(s.id) ? layout.open : [...layout.open, s.id],
      active: s.id,
    });
  };
  const closeTab = (id: string): void => {
    const rest = layout.open.filter((o) => o !== id);
    update({
      ...layout,
      open: rest,
      active: layout.active === id ? (rest[0] ?? null) : layout.active,
      panes: layout.panes.filter((p) => p !== id),
    });
  };

  const capacity = CAPACITY[layout.split];
  const shown: string[] = [];
  for (let i = 0; i < capacity; i++) {
    const id =
      layout.split === "single" ? (layout.active ?? openIds[0]) : (layout.panes[i] ?? openIds[i]);
    if (id && byId.has(id) && !shown.includes(id)) shown.push(id);
  }
  const setPane = (index: number, id: string): void => {
    const panes = Array.from({ length: capacity }, (_, i) => layout.panes[i] ?? openIds[i] ?? "");
    panes[index] = id;
    update({ ...layout, panes: panes.filter(Boolean) });
  };

  const gridClass =
    layout.split === "columns"
      ? "grid-cols-2"
      : layout.split === "rows"
        ? "grid-rows-2"
        : layout.split === "grid"
          ? "grid-cols-2 grid-rows-2"
          : "";
  const splits: Array<[Layout["split"], typeof Square, string]> = [
    ["single", Square, "Single"],
    ["columns", Columns2, "Side by side"],
    ["rows", Rows2, "Stacked"],
    ["grid", LayoutGrid, "Four panes"],
  ];

  const sessionList = (
    <SessionList
      sessions={list}
      active={layout.active}
      onOpen={open}
      onChanged={sessions.reload}
      onCloseSession={setClosing}
    />
  );
  const work = (
    <div className="flex h-full min-w-0 flex-col">
      <div className="agent-tabs" data-testid="tabs">
        {openIds.map((id) => {
          const s = byId.get(id);
          return (
            <div
              key={id}
              data-testid="tab"
              className="agent-tab"
              data-active={layout.active === id}
              onClick={() => update({ ...layout, active: id })}
            >
              {s?.title ?? id.slice(0, 8)}
              <IconButton
                size="sm"
                label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
              >
                <X />
              </IconButton>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && (
        <EmptyState title="Nothing open">
          Open a session from the list, or start a new agent.
        </EmptyState>
      )}
      <div className={`grid min-h-0 flex-1 gap-1 p-1 ${gridClass}`} data-testid="panes">
        {shown.map((id, index) => (
          <div key={`${index}-${id}`} className="agent-pane" data-testid="pane">
            {(layout.split !== "single" || byId.get(id)?.mode !== "chat") && (
              <PaneHeader
                session={byId.get(id)}
                options={openIds.map((o) => ({ id: o, title: byId.get(o)?.title ?? o }))}
                split={layout.split !== "single"}
                onPick={(next) => setPane(index, next)}
                onChanged={() => sessions.reload()}
              />
            )}
            <div className="ui-panel-bg min-h-0 flex-1">
              {byId.get(id) && (
                <SessionSurface
                  session={byId.get(id) as SessionRow}
                  onChanged={() => sessions.reload()}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

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
        <div className="flex-1" />
        {splits.map(([id, Icon, label]) => (
          <IconButton
            key={id}
            label={label}
            variant={layout.split === id ? "secondary" : "ghost"}
            aria-pressed={layout.split === id}
            onClick={() => update({ ...layout, split: id })}
            data-testid={`split-${id}`}
          >
            <Icon />
          </IconButton>
        ))}
      </div>
      {sessions.error && <Banner tone="danger">{sessions.error}</Banner>}
      <SplitPane
        id="agents"
        defaultSize={320}
        min={240}
        minSecond={420}
        first={sessionList}
        second={work}
      />
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
          onClose={() => setStarting(false)}
          onStarted={(session) => {
            setStarting(false);
            sessions.reload();
            update({
              ...layout,
              open: layout.open.includes(session.id) ? layout.open : [...layout.open, session.id],
              active: session.id,
            });
          }}
        />
      )}
    </Page>
  );
}
