import { Code, FolderOpen, Play, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../components/Markdown";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../components/ui";
import { office } from "../lib/ipc";
import { timeAgo, useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";

type Tab = "overview" | "todos" | "agents" | "notes";

function Overview({ id }: { id: string }) {
  const detail = useQuery("projects.get", { id }, ["project.status"]);
  const d = detail.data;
  if (detail.error) return <ErrorBanner message={detail.error} />;
  if (!d) return null;
  const s = d.status;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Git state">
        {!s && (
          <EmptyState>
            {d.summary.exists ? "This folder is not a git repo." : "The project folder is missing."}
          </EmptyState>
        )}
        {s && (
          <div className="grid grid-cols-[110px_1fr] gap-y-1" data-testid="git-state">
            <span style={{ color: "var(--muted)" }}>Branch</span>
            <span>{s.detached ? "detached HEAD" : s.branch}</span>
            <span style={{ color: "var(--muted)" }}>Upstream</span>
            <span>{s.upstream ?? "none"}</span>
            <span style={{ color: "var(--muted)" }}>Ahead / behind</span>
            <span>
              {s.ahead} / {s.behind}
            </span>
            <span style={{ color: "var(--muted)" }}>Last commit</span>
            <span>
              {d.lastCommit
                ? `${d.lastCommit.subject} (${timeAgo(d.lastCommit.date)})`
                : "none yet"}
            </span>
            <span style={{ color: "var(--muted)" }}>Origin</span>
            <span className="break-all">{d.origin ?? "none"}</span>
          </div>
        )}
      </Panel>
      <Panel title={`Changed files (${s?.files.length ?? 0})`}>
        {s?.files.length === 0 && <EmptyState>Working tree is clean.</EmptyState>}
        <ul className="m-0 max-h-72 list-none overflow-auto p-0 font-mono text-[12.5px]">
          {s?.files.slice(0, 60).map((f) => (
            <li key={f.path}>
              <span style={{ color: "var(--muted)" }}>
                {f.index}
                {f.worktree}
              </span>{" "}
              {f.path}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Pull requests and CI">
        <EmptyState>Pull requests and CI results arrive with the Git desk.</EmptyState>
      </Panel>
    </div>
  );
}

function Todos({ id }: { id: string }) {
  const items = useQuery("vault.openItems", { projectId: id }, ["vault.changed"]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = async (): Promise<void> => {
    if (!text.trim()) return;
    setError(null);
    try {
      await office.invoke("vault.addWaiting", { projectId: id, text });
      setText("");
      items.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const tick = async (raw: string): Promise<void> => {
    setError(null);
    try {
      await office.invoke("vault.tickWaiting", { projectId: id, raw });
      items.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const v = items.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Waiting on you">
        {error && <ErrorBanner message={error} />}
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add something that waits on you"
            aria-label="New waiting item"
            className="flex-1 rounded border px-2 py-1"
            style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          />
          <Button type="submit" data-testid="add-waiting">
            <Plus size={13} /> Add
          </Button>
        </form>
        {v && !v.exists && (
          <EmptyState>
            This project has no OpenItems note yet. Adding an item creates it.
          </EmptyState>
        )}
        {v?.exists && v.waiting.length === 0 && (
          <EmptyState>Nothing is waiting on you here.</EmptyState>
        )}
        {v?.waiting.map((w) => (
          <div
            key={w.raw}
            className="flex items-start gap-2 border-b py-1.5"
            style={{ borderColor: "var(--line)" }}
            data-testid="project-waiting"
          >
            <div className="flex-1">
              {w.text}
              <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                {w.date}
                {w.source ? `, ${w.source}` : ""}
              </div>
            </div>
            <Button onClick={() => void tick(w.raw)} data-testid="project-done">
              Done
            </Button>
          </div>
        ))}
        {v?.unparsed.map((u) => (
          <div key={u.line} className="py-1">
            <Chip tone="warn">unparsed</Chip> <code>{u.text}</code>
          </div>
        ))}
      </Panel>
      <Panel title="Todos">
        {v?.groups.length === 0 && <EmptyState>No other sections in OpenItems.</EmptyState>}
        {v?.groups.map((g) => (
          <div key={g.heading} className="mb-3">
            <div className="mb-1 font-semibold">{g.heading}</div>
            <ul className="m-0 list-none p-0">
              {g.items.map((i) => (
                <li key={i.line} style={{ opacity: i.checked ? 0.55 : 1 }}>
                  {i.checked === null ? "• " : i.checked ? "☑ " : "☐ "}
                  {i.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function ProjectAgents({ id }: { id: string }) {
  const navigate = useUi((s) => s.navigate);
  const sessions = useQuery("sessions.list", { projectId: id }, ["session.status"]);
  return (
    <Panel title="Agents here">
      {sessions.data?.length === 0 && (
        <EmptyState>No agent sessions for this project yet.</EmptyState>
      )}
      {sessions.data?.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-2 border-b py-1.5"
          style={{ borderColor: "var(--line)" }}
          data-testid="project-session"
        >
          <span className="flex-1">{s.title ?? s.provider}</span>
          <Chip
            tone={s.status === "needs-you" ? "warn" : s.status === "failed" ? "bad" : "neutral"}
          >
            {s.status}
          </Chip>
          <Button onClick={() => navigate("agents", { project: id, session: s.id })}>Open</Button>
        </div>
      ))}
    </Panel>
  );
}

function Notes({ id, initial }: { id: string; initial?: string }) {
  const [name, setName] = useState(initial ?? "Overview");
  const note = useQuery("notes.read", { projectId: id, name }, ["vault.changed"]);
  const names = Array.from(new Set(["Overview", "OpenItems", ...(initial ? [initial] : [])]));
  return (
    <Panel
      title="Notes"
      action={
        <div className="flex gap-1">
          {names.map((n) => (
            <Button key={n} variant={n === name ? "primary" : "default"} onClick={() => setName(n)}>
              {n}
            </Button>
          ))}
        </div>
      }
    >
      {note.data && !note.data.exists && (
        <EmptyState>There is no {name} note for this project.</EmptyState>
      )}
      {note.data?.exists && <Markdown>{note.data.markdown}</Markdown>}
    </Panel>
  );
}

/** A project's page: git state, todos, agents and notes. */
export function ProjectPage({
  id,
  tab: initialTab,
  note,
}: {
  id: string;
  tab?: string;
  note?: string;
}) {
  const navigate = useUi((s) => s.navigate);
  const projects = useQuery("projects.list", undefined, ["project.status"]);
  const project = projects.data?.find((p) => p.id === id);
  const [tab, setTab] = useState<Tab>((initialTab as Tab | undefined) ?? "overview");
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  const sync = async (): Promise<void> => {
    setSyncing(true);
    await run(async () => {
      const report = await office.invoke("git.syncProject", { id });
      const r = report.repos[0];
      setMessage(
        r ? `${r.name}: ${r.action}${r.reason ? ` (${r.reason})` : ""}` : "Nothing to sync",
      );
    });
    setSyncing(false);
  };

  if (!project) {
    return (
      <div className="p-6">
        <EmptyState>That project is not in the workspace config.</EmptyState>
        <div className="text-center">
          <Button onClick={() => navigate("projects")}>Back to projects</Button>
        </div>
      </div>
    );
  }
  const tabs: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["todos", "Todos"],
    ["agents", "Agents"],
    ["notes", "Notes"],
  ];
  return (
    <div className="p-4" data-testid="project-page">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="m-0 mr-2 text-lg font-semibold">{project.name}</h1>
        {project.group && <Chip>{project.group}</Chip>}
        {project.waiting > 0 && <Chip tone="warn">{project.waiting} waiting</Chip>}
        <div className="flex-1" />
        <Button
          onClick={() => navigate("agents", { project: id, start: "1" })}
          data-testid="start-agent"
        >
          <Play size={13} /> Start agent
        </Button>
        <Button onClick={() => void run(() => office.invoke("projects.openEditor", { id }))}>
          <Code size={13} /> Open in editor
        </Button>
        <Button onClick={() => void run(() => office.invoke("projects.openFolder", { id }))}>
          <FolderOpen size={13} /> Open folder
        </Button>
        <Button onClick={() => void sync()} disabled={syncing} data-testid="project-sync">
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Sync
        </Button>
      </div>
      {message && (
        <div className="mb-3" data-testid="project-message">
          <ErrorBanner message={message} />
        </div>
      )}
      <div className="mb-3 flex gap-1 border-b" style={{ borderColor: "var(--line)" }}>
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
            className="cursor-pointer border-0 bg-transparent px-3 py-1.5"
            style={{
              color: "var(--text)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview id={id} />}
      {tab === "todos" && <Todos id={id} />}
      {tab === "agents" && <ProjectAgents id={id} />}
      {tab === "notes" && <Notes id={id} {...(note ? { initial: note } : {})} />}
    </div>
  );
}
