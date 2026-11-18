import { Archive, LayoutGrid, Play, Rows2, Columns2, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Layout, SessionRow, SessionStatus } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner } from "../components/ui";
import { office } from "../lib/ipc";
import { timeAgo, useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { StartAgentDialog } from "./agents/StartAgentDialog";
import { TerminalView } from "./agents/TerminalView";

const EMPTY: Layout = { open: [], active: null, split: "single", panes: [] };
const CAPACITY: Record<Layout["split"], number> = { single: 1, columns: 2, rows: 2, grid: 4 };

const tone = (s: SessionStatus): "neutral" | "good" | "warn" | "bad" =>
  s === "working" ? "good" : s === "needs-you" ? "warn" : s === "failed" ? "bad" : "neutral";

function SessionList({
  sessions,
  active,
  onOpen,
  onChanged,
}: {
  sessions: SessionRow[];
  active: string | null;
  onOpen: (s: SessionRow) => void;
  onChanged: () => void;
}) {
  const projects = useQuery("projects.list");
  const name = (id: string | null): string => projects.data?.find((p) => p.id === id)?.name ?? "";
  return (
    <div
      className="flex w-72 shrink-0 flex-col overflow-auto border-r"
      style={{ borderColor: "var(--line)" }}
      data-testid="session-list"
    >
      {sessions.length === 0 && <EmptyState>No sessions yet. Start an agent to begin.</EmptyState>}
      {sessions.map((s) => (
        <div
          key={s.id}
          data-testid="session-row"
          onClick={() => onOpen(s)}
          className="cursor-pointer border-b px-3 py-2"
          style={{
            borderColor: "var(--line)",
            background: active === s.id ? "var(--panel)" : "transparent",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate font-medium">{s.title ?? s.provider}</span>
            <span data-testid="session-status">
              <Chip tone={tone(s.status)}>{s.status}</Chip>
            </span>
          </div>
          <div
            className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]"
            style={{ color: "var(--muted)" }}
          >
            {name(s.projectId) && <span>{name(s.projectId)}</span>}
            {s.branch && <span>{s.branch}</span>}
            {s.role && <span>role {s.role}</span>}
            <span>{timeAgo(s.updatedAt)}</span>
          </div>
          <div className="mt-1 flex gap-1.5">
            {!s.running && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  void office
                    .invoke("sessions.resume", { id: s.id })
                    .then(onChanged, () => undefined);
                }}
                data-testid="resume-session"
              >
                <Play size={12} /> Resume
              </Button>
            )}
            {s.running && (
              <Button
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  void office.invoke("sessions.kill", { id: s.id }).then(onChanged);
                }}
                data-testid="stop-session"
              >
                <Square size={12} /> Stop
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                void office.invoke("sessions.archive", { id: s.id }).then(onChanged);
              }}
              data-testid="archive-session"
            >
              <Archive size={12} /> Archive
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Sessions on the left, terminals on the right in tabs with up to four panes; the layout is saved per project. */
export function Agents() {
  const params = useUi((s) => s.params);
  const [filter, setFilter] = useState(params["project"] ?? "");
  const key = filter || "all";
  const sessions = useQuery("sessions.list", filter ? { projectId: filter } : {}, [
    "session.status",
  ]);
  const projects = useQuery("projects.list");
  const [saved, setLayout] = useState<Layout>(EMPTY);
  const [starting, setStarting] = useState(params["start"] === "1");

  useEffect(() => {
    let alive = true;
    void office.invoke("layout.get", { key }).then((loaded) => {
      if (!alive) return;
      setLayout(loaded ?? EMPTY);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const update = (next: Layout): void => {
    setLayout(next);
    void office.invoke("layout.set", { key, layout: next });
  };

  const list = sessions.data ?? [];
  const byId = new Map(list.map((s) => [s.id, s]));
  // A session named in the link opens as a tab even before the layout has it.
  const wanted = params["session"];
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

  return (
    <div className="flex h-full flex-col" data-testid="agents">
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--line)" }}
      >
        <h1 className="m-0 mr-2 text-lg font-semibold">Agents</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Project filter"
          className="rounded border px-1 py-0.5"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--text)" }}
        >
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {splits.map(([id, Icon, label]) => (
          <Button
            key={id}
            variant={layout.split === id ? "primary" : "ghost"}
            aria-label={label}
            title={label}
            onClick={() => update({ ...layout, split: id })}
            data-testid={`split-${id}`}
          >
            <Icon size={14} />
          </Button>
        ))}
        <Button variant="primary" onClick={() => setStarting(true)} data-testid="start-agent-open">
          <Play size={13} /> Start agent
        </Button>
      </div>
      {sessions.error && <ErrorBanner message={sessions.error} />}
      <div className="flex min-h-0 flex-1">
        <SessionList
          sessions={list}
          active={layout.active}
          onOpen={open}
          onChanged={sessions.reload}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="flex gap-1 border-b px-2 pt-1"
            style={{ borderColor: "var(--line)" }}
            data-testid="tabs"
          >
            {openIds.map((id) => {
              const s = byId.get(id);
              return (
                <div
                  key={id}
                  data-testid="tab"
                  onClick={() => update({ ...layout, active: id })}
                  className="flex cursor-pointer items-center gap-1.5 rounded-t border border-b-0 px-2 py-1"
                  style={{
                    borderColor: "var(--line)",
                    background: layout.active === id ? "var(--panel)" : "transparent",
                  }}
                >
                  {s?.title ?? id.slice(0, 8)}
                  <button
                    aria-label="Close tab"
                    className="cursor-pointer border-0 bg-transparent p-0"
                    style={{ color: "var(--muted)" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          {shown.length === 0 && (
            <EmptyState>Open a session from the list, or start a new agent.</EmptyState>
          )}
          <div className={`grid min-h-0 flex-1 gap-1 p-1 ${gridClass}`} data-testid="panes">
            {shown.map((id, index) => (
              <div
                key={`${index}-${id}`}
                className="flex min-h-0 min-w-0 flex-col rounded border"
                style={{ borderColor: "var(--line)" }}
                data-testid="pane"
              >
                {layout.split !== "single" && (
                  <select
                    value={id}
                    onChange={(e) => setPane(index, e.target.value)}
                    aria-label="Pane session"
                    className="border-0 border-b px-1 py-0.5"
                    style={{
                      borderColor: "var(--line)",
                      background: "var(--panel)",
                      color: "var(--text)",
                    }}
                  >
                    {openIds.map((o) => (
                      <option key={o} value={o}>
                        {byId.get(o)?.title ?? o}
                      </option>
                    ))}
                  </select>
                )}
                <div className="min-h-0 flex-1" style={{ background: "#14161a" }}>
                  <TerminalView id={id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {starting && (
        <StartAgentDialog
          {...(filter ? { projectId: filter } : {})}
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
    </div>
  );
}
