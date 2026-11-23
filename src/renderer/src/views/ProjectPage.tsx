import { Play } from "lucide-react";
import { useState } from "react";
import type { ProjectSummary } from "@shared/models";
import { labelOf } from "@shared/tone";
import { PrsPanel } from "../components/PrsPanel";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { fixAction } from "../lib/fix";
import { useUi } from "../stores/ui";
import {
  Banner,
  Button,
  Card,
  CardGrid,
  EmptyState,
  Input,
  Page,
  StatusBadge,
  Workbench,
  splitBeside,
  tabsTogether,
  type PanelComponent,
  type WorkbenchPreset,
  Time,
  notify,
  notifyError,
  type MoreItem,
} from "../ui";
import { InspectorSlot } from "../components/Inspector";
import { BranchesTab } from "./git/BranchesTab";
import { PreviewTab } from "./PreviewTab";
import { Notes } from "./project/Notes";
import { CatchMeUp } from "./project/CatchMeUp";
import { ProjectInspector } from "./project/ProjectInspector";
import { useProjectManage } from "./project/Manage";
import { RecentRuns } from "./project/RecentRuns";
import { GitRulesPanel } from "./setup/GitRulesPanel";

type Tab = "overview" | "todos" | "agents" | "notes" | "preview" | "git";

const TITLES: Record<Tab, string> = {
  overview: "Overview",
  todos: "Todos",
  agents: "Sessions",
  notes: "Notes",
  preview: "Preview",
  git: "Git",
};
const TABS = Object.keys(TITLES) as Tab[];

/** One panel of the project page: the part of the project it shows, drawn for the project in its params. */
const ProjectPanel: PanelComponent = ({ params }) => {
  const id = String(params["id"] ?? "");
  const kind = String(params["kind"] ?? "overview") as Tab;
  const note = typeof params["note"] === "string" ? params["note"] : undefined;
  const section = typeof params["section"] === "string" ? params["section"] : undefined;
  return (
    <div className="dock-panel" data-flush={kind === "preview" ? "true" : undefined}>
      {kind === "overview" && <Overview id={id} />}
      {kind === "todos" && <Todos id={id} />}
      {kind === "agents" && <ProjectAgents id={id} />}
      {kind === "notes" && (
        <Notes id={id} {...(note ? { initial: note } : {})} {...(section ? { section } : {})} />
      )}
      {kind === "preview" && <PreviewTab projectId={id} />}
      {kind === "git" && <BranchesTab key={id} projectId={id} />}
    </div>
  );
};
const PROJECT_COMPONENTS: Record<string, PanelComponent> = { project: ProjectPanel };

const PROJECT_PRESETS: WorkbenchPreset[] = [
  { id: "tabs", label: "Tabs: one at a time", apply: (api) => tabsTogether(api) },
  {
    id: "side",
    label: "Overview beside Todos",
    apply: (api) => {
      tabsTogether(api);
      splitBeside(api, "todos", "overview");
    },
  },
  {
    id: "review",
    label: "Review: Overview, Git and Preview",
    apply: (api) => {
      tabsTogether(api);
      splitBeside(api, "git", "overview");
      splitBeside(api, "preview", "git", "below");
    },
  },
];

function Overview({ id }: { id: string }) {
  const detail = useQuery("projects.get", { id }, ["project.status"]);
  const d = detail.data;
  if (detail.error) return <Banner tone="danger">{detail.error}</Banner>;
  if (!d) return null;
  const s = d.status;
  return (
    <CardGrid>
      <Card title="Git state" testId="panel-git-state">
        {!s && (
          <EmptyState title={d.summary.exists ? "Not a git repo" : "The project folder is missing"}>
            {d.summary.exists
              ? "This folder is not a git repo."
              : "Locate it from the Projects page."}
          </EmptyState>
        )}
        {s && (
          <dl className="ui-dl" data-testid="git-state">
            <dt>Branch</dt>
            <dd>{s.detached ? "Detached HEAD" : s.branch}</dd>
            <dt>Upstream</dt>
            <dd>{s.upstream ?? "None"}</dd>
            <dt>To push and pull</dt>
            <dd>
              <span className="ui-badges">
                {s.ahead === 0 && s.behind === 0 && <StatusBadge status="up-to-date" />}
                {s.ahead > 0 && <StatusBadge status="ahead" label={`${s.ahead} to push`} />}
                {s.behind > 0 && <StatusBadge status="behind" label={`${s.behind} to pull`} />}
              </span>
            </dd>
            <dt>Last commit</dt>
            <dd>
              {d.lastCommit ? (
                <>
                  {d.lastCommit.subject} (<Time iso={d.lastCommit.date} />)
                </>
              ) : (
                "None yet"
              )}
            </dd>
            <dt>Origin</dt>
            <dd className="break-all">{d.origin ?? "None"}</dd>
          </dl>
        )}
      </Card>
      <Card title={`Changed files (${s?.files.length ?? 0})`} testId="panel-changed">
        {s?.files.length === 0 && (
          <EmptyState title="Nothing changed">The working tree is clean.</EmptyState>
        )}
        <ul className="m-0 max-h-72 list-none overflow-auto p-0">
          {s?.files.slice(0, 60).map((f) => (
            <li key={f.path} className="ui-path">
              <span className="ui-muted">
                {f.index}
                {f.worktree}
              </span>{" "}
              {f.path}
            </li>
          ))}
        </ul>
      </Card>
      <PrsPanel projectId={id} />
      <RecentRuns id={id} />
      {s && <GitRulesPanel projectId={id} />}
    </CardGrid>
  );
}

function Todos({ id }: { id: string }) {
  const items = useQuery("vault.openItems", { projectId: id }, ["vault.changed"]);
  const [text, setText] = useState("");
  const add = async (): Promise<void> => {
    if (!text.trim()) return;
    try {
      await office.invoke("vault.addWaiting", { projectId: id, text });
      setText("");
      items.reload();
    } catch (err) {
      notifyError(err, "Could not add that", `todo-${id}`);
    }
  };
  const tick = async (raw: string): Promise<void> => {
    try {
      await office.invoke("vault.tickWaiting", { projectId: id, raw });
      items.reload();
    } catch (err) {
      notifyError(err, "Could not mark that done", `todo-${id}`);
    }
  };
  const tickTodo = async (line: number, itemText: string, checked: boolean): Promise<void> => {
    try {
      await office.invoke("vault.tickTodo", { projectId: id, line, text: itemText, checked });
      items.reload();
    } catch (err) {
      notifyError(err, "Could not change that todo", `todo-${id}`);
    }
  };
  const v = items.data;
  return (
    <CardGrid>
      <Card title="Waiting on you" testId="panel-project-waiting">
        <form
          className="mb-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            className="flex-1"
            label="New waiting item"
            hideLabel
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add something that waits on you"
          />
          <Button type="submit" data-testid="add-waiting">
            Add
          </Button>
        </form>
        {v && !v.exists && (
          <EmptyState title="No OpenItems note yet">Adding an item creates it.</EmptyState>
        )}
        {v?.exists && v.waiting.length === 0 && (
          <EmptyState title="Nothing is waiting on you here">
            Items you add show up here.
          </EmptyState>
        )}
        {v?.waiting.map((w) => (
          <div key={w.raw} className="ui-line" data-testid="project-waiting">
            <div className="ui-line-main">
              {w.text}
              <div className="ui-line-sub">
                {w.date}
                {w.source ? `, ${w.source}` : ""}
              </div>
            </div>
            <Button size="sm" onClick={() => void tick(w.raw)} data-testid="project-done">
              Done
            </Button>
          </div>
        ))}
        {v?.unparsed.map((u) => (
          <div key={u.line} className="ui-line">
            <StatusBadge status="behind" label="Not understood" />
            <code className="ui-line-main">{u.text}</code>
          </div>
        ))}
      </Card>
      <Card title="Todos" testId="panel-todos">
        {v?.groups.length === 0 && (
          <EmptyState title="No other sections">
            OpenItems has nothing besides what waits on you.
          </EmptyState>
        )}
        {v?.groups.map((g) => (
          <section key={g.heading}>
            <h3 className="ui-group">{g.heading}</h3>
            <ul className="m-0 list-none p-0">
              {g.items.map((i) => (
                <li
                  key={i.line}
                  className="flex items-start gap-2 py-1"
                  style={{ opacity: i.checked ? 0.6 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={i.checked === true}
                    onChange={() => void tickTodo(i.line, i.text, i.checked !== true)}
                    aria-label={`Done: ${i.text}`}
                    data-testid="todo-tick"
                  />
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Card>
    </CardGrid>
  );
}

function ProjectAgents({ id }: { id: string }) {
  const navigate = useUi((s) => s.navigate);
  const sessions = useQuery("sessions.list", { projectId: id }, ["session.status"]);
  return (
    <Card title="Agents here" testId="panel-project-agents">
      {sessions.data?.length === 0 && (
        <EmptyState title="No agent sessions yet">Start one with the button at the top.</EmptyState>
      )}
      {sessions.data?.map((s) => (
        <div key={s.id} className="ui-line" data-testid="project-session">
          <div className="ui-line-main">{s.title ?? s.provider}</div>
          <StatusBadge status={s.status} />
          <Button size="sm" onClick={() => navigate("agents", { project: id, session: s.id })}>
            Open
          </Button>
        </div>
      ))}
    </Card>
  );
}

/** A project's page: git state, todos, agents and notes. */
export function ProjectPage({
  id,
  tab,
  note,
  section,
}: {
  id: string;
  tab?: string;
  note?: string;
  section?: string;
}) {
  const navigate = useUi((s) => s.navigate);
  const projects = useQuery("projects.list", undefined, ["project.status", "workspace.changed"]);
  const project = projects.data?.find((p) => p.id === id);
  if (!project) {
    return (
      <Page
        title="Project not found"
        testId="project-page"
        breadcrumb={[{ label: "Projects", onClick: () => navigate("projects") }]}
      >
        <EmptyState
          title="That project is not in the workspace config"
          action={<Button onClick={() => navigate("projects")}>Back to projects</Button>}
        />
      </Page>
    );
  }
  return (
    <ProjectBody
      project={project}
      {...(tab ? { tab } : {})}
      {...(note ? { note } : {})}
      {...(section ? { section } : {})}
    />
  );
}

function ProjectBody({
  project,
  tab: initialTab,
  note,
  section,
}: {
  project: ProjectSummary;
  tab?: string;
  note?: string;
  section?: string;
}) {
  const id = project.id;
  const navigate = useUi((s) => s.navigate);
  const tab: Tab = TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "overview";
  const unreal = useQuery("projects.unrealFile", { id }).data;
  const manage = useProjectManage(project);

  const run = async (title: string, work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch (err) {
      notifyError(err, title, `project-${id}`, fixAction(title, err, { projectId: id }));
    }
  };
  const sync = async (): Promise<void> => {
    try {
      const report = await office.invoke("git.syncProject", { id });
      const r = report.repos[0];
      if (!r) notify({ tone: "info", title: "Nothing to sync", subject: `sync-${id}` });
      else {
        const ok = ["pulled", "pushed", "pulled-and-pushed", "up-to-date"].includes(r.action);
        notify({
          tone: ok ? "success" : r.action === "conflict" ? "danger" : "attention",
          title: `${r.name}: ${labelOf(r.action).toLowerCase()}`,
          detail: r.reason,
          subject: `sync-${id}`,
        });
      }
    } catch (err) {
      notifyError(
        err,
        "Sync did not finish",
        `sync-${id}`,
        fixAction("Sync did not finish", err, { projectId: id }),
      );
    }
  };

  const [catching, setCatching] = useState(false);
  const more: MoreItem[] = [
    { label: "Sync", onSelect: () => void sync(), testId: "project-sync" },
    {
      label: "Open in editor",
      onSelect: () =>
        void run("Could not open the editor", () => office.invoke("projects.openEditor", { id })),
    },
    ...(unreal
      ? [
          {
            label: "Open in Unreal",
            onSelect: () =>
              void run("Could not open Unreal", () => office.invoke("projects.openUnreal", { id })),
            testId: "open-unreal",
          },
        ]
      : []),
    { label: "Catch me up", onSelect: () => setCatching(true), testId: "catch-me-up" },
    {
      label: "Open folder",
      onSelect: () =>
        void run("Could not open the folder", () => office.invoke("projects.openFolder", { id })),
    },
    ...manage.items,
  ];
  return (
    <Page
      testId="project-page"
      fill
      title={project.name}
      breadcrumb={[{ label: "Projects", onClick: () => navigate("projects") }]}
      subtitle={
        <span className="ui-badges">
          <span>Everything about this project: where it stands, its work and its notes.</span>
          {project.group && <span>{project.group}</span>}
          {project.waiting > 0 && (
            <StatusBadge status="waiting" label={`${project.waiting} waiting`} />
          )}
        </span>
      }
      primary={
        <Button
          variant="primary"
          onClick={() => navigate("agents", { project: id, start: "1" })}
          data-testid="start-agent"
        >
          <Play /> Start a session
        </Button>
      }
      more={more}
    >
      {manage.dialogs}
      {catching && <CatchMeUp projectId={id} onClose={() => setCatching(false)} />}
      <InspectorSlot view="project">
        <ProjectInspector id={id} />
      </InspectorSlot>
      <div className="min-h-0 flex-1">
        <Workbench
          key={id}
          workbench="project"
          scope={id}
          components={PROJECT_COMPONENTS}
          presets={PROJECT_PRESETS}
          catalog={TABS.map((kind) => ({
            id: kind,
            title: TITLES[kind],
            add: (api) =>
              api.addPanel({
                id: kind,
                component: "project",
                title: TITLES[kind],
                params: {
                  kind,
                  id,
                  testId: `tab-${kind}`,
                  ...(note ? { note } : {}),
                  ...(section ? { section } : {}),
                },
              }),
          }))}
          initial={(api) => {
            for (const kind of TABS)
              api.addPanel({
                id: kind,
                component: "project",
                title: TITLES[kind],
                params: {
                  kind,
                  id,
                  testId: `tab-${kind}`,
                  ...(note ? { note } : {}),
                  ...(section ? { section } : {}),
                },
              });
            api.getPanel(tab)?.api.setActive();
          }}
          onReady={(api) => api.getPanel(tab)?.api.setActive()}
        />
      </div>
    </Page>
  );
}
