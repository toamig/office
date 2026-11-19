import { GitBranch, Pin } from "lucide-react";
import type { ProjectSummary } from "@shared/models";
import { useState } from "react";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
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

function Section({ title, items }: { title: string; items: ProjectSummary[] }) {
  return (
    <section>
      <Group>{title}</Group>
      <CardGrid>
        {items.map((p) => (
          <ProjectCard key={`${title}-${p.id}`} p={p} />
        ))}
      </CardGrid>
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
  return (
    <Page
      title="Projects"
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
      {pinned.length > 0 && <Section title="Pinned" items={pinned} />}
      {[...groups.entries()].map(([name, items]) => (
        <Section key={name} title={name} items={items} />
      ))}
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
