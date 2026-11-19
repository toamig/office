import { GitBranch, Pin } from "lucide-react";
import type { ProjectSummary } from "@shared/models";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner } from "../components/ui";
import { office } from "../lib/ipc";
import { timeAgo, useQuery } from "../lib/hooks";
import { createPortal } from "react-dom";
import { useEscape } from "../lib/escape";
import { useUi } from "../stores/ui";
import { AddProjects } from "./onboarding/AddProjects";

/** The add-projects panel in a dialog of its own. */
function AddProjectsDialog({ onClose }: { onClose: () => void }) {
  useEscape(onClose, true);
  return createPortal(
    <div className="dialog-backdrop" data-testid="add-projects-dialog">
      <div className="dialog w-[920px] max-w-[94vw]">
        <header className="dialog-header">
          <span className="font-semibold">Add projects</span>
        </header>
        <div className="overflow-auto p-4">
          <AddProjects />
        </div>
        <footer
          className="flex justify-end border-t px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <Button onClick={onClose} data-testid="add-projects-close">
            Close
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Card({ p }: { p: ProjectSummary }) {
  const navigate = useUi((s) => s.navigate);
  const locate = async (): Promise<void> => {
    const path = await office.invoke("setup.pickFolder", { title: `Where is ${p.name}?` });
    if (path) await office.invoke("projects.locate", { id: p.id, path });
  };
  return (
    <div
      data-testid="project-card"
      role="button"
      tabIndex={0}
      onClick={() => navigate("project", { id: p.id })}
      onKeyDown={(e) => e.key === "Enter" && navigate("project", { id: p.id })}
      className="flex flex-col gap-1.5 rounded border p-3 text-left"
      style={{ background: "var(--panel)", borderColor: "var(--line)", color: "var(--text)" }}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {p.pinned && <Pin size={12} />}
        {p.name}
      </div>
      {!p.exists && (
        <>
          <Chip tone="bad">folder missing</Chip>
          <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button onClick={() => navigate("setup")} data-testid="change-projects-folder">
              Change projects folder
            </Button>
            <Button onClick={() => void locate()} data-testid="locate-project">
              Locate this folder
            </Button>
          </div>
        </>
      )}
      {p.exists && !p.isRepo && <Chip tone="warn">not a git repo</Chip>}
      {p.isRepo && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1" style={{ color: "var(--muted)" }}>
            <GitBranch size={12} />
            {p.detached ? "detached" : (p.branch ?? "?")}
          </span>
          {p.changed > 0 && <Chip tone="warn">{p.changed} changed</Chip>}
          {p.ahead > 0 && <Chip>{p.ahead} ahead</Chip>}
          {p.behind > 0 && <Chip>{p.behind} behind</Chip>}
        </div>
      )}
      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--muted)" }}>
        {p.waiting > 0 && <Chip tone="warn">{p.waiting} waiting</Chip>}
        <span>last activity {timeAgo(p.lastActivity)}</span>
      </div>
    </div>
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
    <div className="p-4" data-testid="projects">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="m-0 flex-1 text-lg font-semibold">Projects</h1>
        <Button variant="primary" onClick={() => setAdding(true)} data-testid="add-projects-open">
          Add projects
        </Button>
      </div>
      {adding && <AddProjectsDialog onClose={() => setAdding(false)} />}
      {projects.error && <ErrorBanner message={projects.error} />}
      {list.length > 0 && list.every((p) => !p.exists) && (
        <div className="mb-3" data-testid="all-folders-missing">
          <ErrorBanner
            message={`None of your project folders were found under ${workspace.data?.projectsRoot || "the projects folder"}. Most likely the projects folder is the wrong one: change it in Setup, or locate each project.`}
          />
          <div className="mt-2">
            <Button
              variant="primary"
              onClick={() => navigate("setup")}
              data-testid="banner-change-folder"
            >
              Change projects folder
            </Button>
          </div>
        </div>
      )}
      {projects.data?.length === 0 && (
        <EmptyState>No projects yet. Add some to the workspace config, or finish Setup.</EmptyState>
      )}
      {pinned.length > 0 && <Section title="Pinned" items={pinned} />}
      {[...groups.entries()].map(([name, items]) => (
        <Section key={name} title={name} items={items} />
      ))}
      {archived.length > 0 && (
        <section className="mb-5" data-testid="archived-projects">
          <Button onClick={() => setShowArchived(!showArchived)} data-testid="toggle-archived">
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </Button>
          {showArchived &&
            archived.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 py-1"
                data-testid="archived-project"
              >
                <span>{p.name}</span>
                <Button
                  onClick={() =>
                    void office.invoke("projects.update", { id: p.id, archived: false })
                  }
                  data-testid="restore-project"
                >
                  Restore
                </Button>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: ProjectSummary[] }) {
  return (
    <section className="mb-5">
      <h2
        className="m-0 mb-2 text-[12px] font-semibold uppercase"
        style={{ color: "var(--muted)" }}
      >
        {title}
      </h2>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
      >
        {items.map((p) => (
          <Card key={`${title}-${p.id}`} p={p} />
        ))}
      </div>
    </section>
  );
}
