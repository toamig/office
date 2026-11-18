import { GitBranch, Pin } from "lucide-react";
import type { ProjectSummary } from "@shared/models";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner } from "../components/ui";
import { office } from "../lib/ipc";
import { timeAgo, useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";

function Card({ p }: { p: ProjectSummary }) {
  const navigate = useUi((s) => s.navigate);
  return (
    <button
      data-testid="project-card"
      onClick={() => navigate("project", { id: p.id })}
      className="flex flex-col gap-1.5 rounded border p-3 text-left"
      style={{ background: "var(--panel)", borderColor: "var(--line)", color: "var(--text)" }}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {p.pinned && <Pin size={12} />}
        {p.name}
      </div>
      {!p.exists && <Chip tone="bad">folder missing</Chip>}
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
    </button>
  );
}

/** A grid of project cards, pinned first, grouped. */
export function Projects() {
  const projects = useQuery("projects.list", undefined, [
    "project.status",
    "workspace.changed",
    "vault.changed",
  ]);
  const list = (projects.data ?? []).filter((p) => !p.archived);
  const groups = new Map<string, ProjectSummary[]>();
  for (const p of list.filter((x) => !x.pinned))
    groups.set(p.group ?? "Other", [...(groups.get(p.group ?? "Other") ?? []), p]);
  const pinned = list.filter((p) => p.pinned);
  const archived = (projects.data ?? []).filter((p) => p.archived);
  const [showArchived, setShowArchived] = useState(false);
  return (
    <div className="p-4" data-testid="projects">
      <h1 className="m-0 mb-3 text-lg font-semibold">Projects</h1>
      {projects.error && <ErrorBanner message={projects.error} />}
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
