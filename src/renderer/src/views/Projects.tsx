import { GitBranch, Pin } from "lucide-react";
import type { ProjectSummary } from "@shared/models";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { labelOf } from "@shared/tone";
import { useUi } from "../stores/ui";
import {
  Banner,
  Button,
  Card,
  CardGrid,
  Dialog,
  EmptyState,
  Group,
  ListRow,
  Page,
  StatusBadge,
  Time,
  notifyError,
} from "../ui";
import { AddProjects } from "./onboarding/AddProjects";

/** The add-projects panel in a dialog of its own. */
function AddProjectsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Add projects"
      wide
      onClose={onClose}
      testId="add-projects-dialog"
      footer={
        <Button onClick={onClose} data-testid="add-projects-close">
          Close
        </Button>
      }
    >
      <AddProjects />
    </Dialog>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const navigate = useUi((s) => s.navigate);
  const locate = async (): Promise<void> => {
    try {
      const path = await office.invoke("setup.pickFolder", { title: `Where is ${p.name}?` });
      if (path) await office.invoke("projects.locate", { id: p.id, path });
    } catch (err) {
      notifyError(err, `Could not locate ${p.name}`, `locate-${p.id}`);
    }
  };
  return (
    <Card testId="project-card" onOpen={() => navigate("project", { id: p.id })}>
      <div className="project-card">
        <div className="flex items-center gap-2 font-semibold">
          {p.pinned && <Pin size={14} aria-label="Pinned" />}
          {p.name}
        </div>
        {!p.exists && (
          <>
            <div className="ui-badges">
              <StatusBadge status="folder-missing" />
            </div>
            <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                onClick={() => navigate("setup")}
                data-testid="change-projects-folder"
              >
                Change projects folder
              </Button>
              <Button size="sm" onClick={() => void locate()} data-testid="locate-project">
                Locate this folder
              </Button>
            </div>
          </>
        )}
        {p.exists && !p.isRepo && (
          <div className="ui-badges">
            <StatusBadge status="not-a-repo" />
          </div>
        )}
        {p.isRepo && (
          <div className="ui-badges">
            <span className="ui-muted flex items-center gap-1">
              <GitBranch size={14} />
              {p.detached ? "detached" : (p.branch ?? "unknown branch")}
            </span>
            {p.changed > 0 && <StatusBadge status="unsaved" label={`${p.changed} changed`} />}
            {p.ahead > 0 && <StatusBadge status="ahead" label={`${p.ahead} to push`} />}
            {p.behind > 0 && <StatusBadge status="behind" label={`${p.behind} to pull`} />}
          </div>
        )}
        <div className="ui-badges ui-line-sub">
          {p.waiting > 0 && <StatusBadge status="waiting" label={`${p.waiting} waiting`} />}
          <span>
            Last activity <Time iso={p.lastActivity} />
          </span>
        </div>
      </div>
    </Card>
  );
}

/** The pull requests and the last CI run of a project, for the table: one short cell. */
function PrCell({ projectId }: { projectId: string }) {
  const overview = useQuery("github.overview", { projectId }, ["project.status"]);
  const d = overview.data;
  if (!d || !d.isGithub || d.error)
    return <span className="ui-muted">{d?.isGithub === false ? "Not on GitHub" : ""}</span>;
  const run = d.runs[0];
  const ci = run
    ? run.conclusion === "success"
      ? "passed"
      : run.conclusion === "failure"
        ? "failed"
        : run.status === "completed"
          ? "cancelled"
          : "running"
    : null;
  return (
    <span className="ui-badges">
      <span>{d.prs.length === 0 ? "No pull requests" : `${d.prs.length} open`}</span>
      {ci && <StatusBadge status={ci} label={`Checks ${labelOf(ci).toLowerCase()}`} />}
    </span>
  );
}

/** One project as a row of aligned columns, so a wide window scans like a table. */
function ProjectRow({ p }: { p: ProjectSummary }) {
  const navigate = useUi((s) => s.navigate);
  const locate = async (): Promise<void> => {
    try {
      const path = await office.invoke("setup.pickFolder", { title: `Where is ${p.name}?` });
      if (path) await office.invoke("projects.locate", { id: p.id, path });
    } catch (err) {
      notifyError(err, `Could not locate ${p.name}`, `locate-${p.id}`);
    }
  };
  return (
    <div
      className="project-row"
      role="button"
      tabIndex={0}
      data-testid="project-card"
      onClick={() => navigate("project", { id: p.id })}
      onKeyDown={(e) =>
        e.target === e.currentTarget && e.key === "Enter" && navigate("project", { id: p.id })
      }
    >
      <span className="flex items-center gap-2 font-semibold">
        {p.pinned && <Pin size={14} aria-label="Pinned" />}
        {p.name}
      </span>
      {!p.exists ? (
        <span className="project-row-wide" onClick={(e) => e.stopPropagation()}>
          <StatusBadge status="folder-missing" />
          <Button size="sm" onClick={() => navigate("setup")} data-testid="change-projects-folder">
            Change projects folder
          </Button>
          <Button size="sm" onClick={() => void locate()} data-testid="locate-project">
            Locate this folder
          </Button>
        </span>
      ) : !p.isRepo ? (
        <span className="project-row-wide">
          <StatusBadge status="not-a-repo" />
        </span>
      ) : (
        <>
          <span className="ui-muted flex items-center gap-1">
            <GitBranch size={14} />
            {p.detached ? "detached" : (p.branch ?? "unknown branch")}
          </span>
          <span>
            {p.changed > 0 ? (
              <StatusBadge status="unsaved" label={`${p.changed} changed`} />
            ) : (
              <span className="ui-muted">Clean</span>
            )}
          </span>
          <span className="ui-badges">
            {p.ahead > 0 && <StatusBadge status="ahead" label={`${p.ahead} to push`} />}
            {p.behind > 0 && <StatusBadge status="behind" label={`${p.behind} to pull`} />}
            {p.ahead === 0 && p.behind === 0 && <span className="ui-muted">In step</span>}
          </span>
          <span>
            {p.waiting > 0 ? (
              <StatusBadge status="waiting" label={`${p.waiting} waiting`} />
            ) : (
              <span className="ui-muted">None</span>
            )}
          </span>
          <PrCell projectId={p.id} />
        </>
      )}
      <span className="ui-line-sub">
        <Time iso={p.lastActivity} />
      </span>
    </div>
  );
}

const COLUMNS = [
  "Name",
  "Branch",
  "Changed",
  "Push and pull",
  "Waiting",
  "Pull requests and CI",
  "Last activity",
];

function Section({
  title,
  items,
  wide,
}: {
  title: string;
  items: ProjectSummary[];
  wide: boolean;
}) {
  return (
    <section>
      <Group>{title}</Group>
      {wide ? (
        <div className="project-table" role="table" aria-label={title}>
          <div className="project-row project-head" role="row">
            {COLUMNS.map((c) => (
              <span key={c} role="columnheader">
                {c}
              </span>
            ))}
          </div>
          {items.map((p) => (
            <ProjectRow key={`${title}-${p.id}`} p={p} />
          ))}
        </div>
      ) : (
        <CardGrid>
          {items.map((p) => (
            <ProjectCard key={`${title}-${p.id}`} p={p} />
          ))}
        </CardGrid>
      )}
    </section>
  );
}

/** A grid of project cards, pinned first, grouped. */
export function Projects() {
  const projects = useQuery("projects.list", undefined, [
    "project.status",
    "workspace.changed",
    "vault.changed",
  ]);
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const navigate = useUi((s) => s.navigate);
  const list = (projects.data ?? []).filter((p) => !p.archived);
  const groups = new Map<string, ProjectSummary[]>();
  for (const p of list.filter((x) => !x.pinned))
    groups.set(p.group ?? "Other", [...(groups.get(p.group ?? "Other") ?? []), p]);
  const pinned = list.filter((p) => p.pinned);
  const archived = (projects.data ?? []).filter((p) => p.archived);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  // A wide page shows aligned columns; a narrow one shows cards.
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(([e]) => setWide((e?.contentRect.width ?? 0) >= 960));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <Page
      title="Projects"
      subtitle="Your projects and where each one stands."
      testId="projects"
      primary={
        <Button variant="primary" onClick={() => setAdding(true)} data-testid="add-projects-open">
          Add projects
        </Button>
      }
    >
      {adding && <AddProjectsDialog onClose={() => setAdding(false)} />}
      {projects.error && <Banner tone="danger">{projects.error}</Banner>}
      {list.length > 0 && list.every((p) => !p.exists) && (
        <Banner
          tone="danger"
          testId="all-folders-missing"
          action={
            <Button
              variant="primary"
              onClick={() => navigate("setup")}
              data-testid="banner-change-folder"
            >
              Change projects folder
            </Button>
          }
        >
          None of your project folders were found under{" "}
          {workspace.data?.projectsRoot || "the projects folder"}. Most likely the projects folder
          is the wrong one: change it in Setup, or locate each project.
        </Banner>
      )}
      {projects.data?.length === 0 && (
        <EmptyState
          title="No projects yet"
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add projects
            </Button>
          }
        >
          Projects are the code repos Office keeps track of.
        </EmptyState>
      )}
      <div ref={box} className="grid gap-4">
        {pinned.length > 0 && <Section title="Pinned" items={pinned} wide={wide} />}
        {[...groups.entries()].map(([name, items]) => (
          <Section key={name} title={name} items={items} wide={wide} />
        ))}
      </div>
      {archived.length > 0 && (
        <section data-testid="archived-projects">
          <Button onClick={() => setShowArchived(!showArchived)} data-testid="toggle-archived">
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </Button>
          {showArchived &&
            archived.map((p) => (
              <ListRow
                key={p.id}
                testId="archived-project"
                trailing={
                  <Button
                    size="sm"
                    onClick={() =>
                      void office
                        .invoke("projects.update", { id: p.id, archived: false })
                        .catch((err: unknown) => notifyError(err, `Could not restore ${p.name}`))
                    }
                    data-testid="restore-project"
                  >
                    Restore
                  </Button>
                }
              >
                {p.name}
              </ListRow>
            ))}
        </section>
      )}
    </Page>
  );
}
