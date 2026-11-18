import { useState } from "react";
import { Chip, EmptyState } from "../components/ui";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { BranchesTab } from "./git/BranchesTab";
import { DiffTab } from "./git/DiffTab";
import { WorktreesTab } from "./git/WorktreesTab";

type Tab = "branches" | "worktrees" | "changes";

/** The Git desk: every repo at a glance, and branches, worktrees, diffs, commits and PRs for the chosen one. */
export function Git() {
  const params = useUi((s) => s.params);
  const projects = useQuery("projects.list", undefined, ["project.status"]);
  const health = useQuery("vault.health", undefined, ["vault.changed"]);
  const [selected, setSelected] = useState(params["project"] ?? "");
  const [tab, setTab] = useState<Tab>(
    params["tab"] === "worktrees"
      ? "worktrees"
      : params["tab"] === "changes"
        ? "changes"
        : "branches",
  );

  const repos = (projects.data ?? []).filter((p) => !p.archived && p.isRepo);
  const current = repos.find((p) => p.id === selected) ?? repos[0];
  const brain = health.data?.repos ?? [];

  return (
    <div className="flex h-full" data-testid="git">
      <div className="w-72 shrink-0 overflow-auto border-r" style={{ borderColor: "var(--line)" }}>
        <div
          className="px-3 py-2 text-[12px] font-semibold uppercase"
          style={{ color: "var(--muted)" }}
        >
          Project repos
        </div>
        {repos.length === 0 && <EmptyState>No git repos among your projects yet.</EmptyState>}
        {repos.map((p) => (
          <div
            key={p.id}
            data-testid="git-repo"
            onClick={() => setSelected(p.id)}
            className="cursor-pointer border-b px-3 py-2"
            style={{
              borderColor: "var(--line)",
              background: current?.id === p.id ? "var(--panel)" : "transparent",
            }}
          >
            <div className="font-medium">{p.name}</div>
            <div
              className="flex flex-wrap items-center gap-1.5 text-[12px]"
              style={{ color: "var(--muted)" }}
            >
              {p.detached ? "detached" : p.branch}
              {p.changed > 0 && <Chip tone="warn">{p.changed} changed</Chip>}
              {p.ahead > 0 && <Chip>{p.ahead} ahead</Chip>}
              {p.behind > 0 && <Chip>{p.behind} behind</Chip>}
            </div>
          </div>
        ))}
        {brain.length > 0 && (
          <>
            <div
              className="px-3 py-2 text-[12px] font-semibold uppercase"
              style={{ color: "var(--muted)" }}
            >
              Brain repos
            </div>
            {brain.map((r) => (
              <div
                key={r.folder}
                className="border-b px-3 py-1.5"
                style={{ borderColor: "var(--line)" }}
                data-testid="brain-repo"
              >
                {r.folder}
                <span
                  className="ml-2 text-[12px]"
                  style={{ color: r.attention ? "#c98a12" : "var(--muted)" }}
                >
                  {r.state}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!current && <EmptyState>Pick a repo on the left.</EmptyState>}
        {current && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <h1 className="m-0 text-lg font-semibold">{current.name}</h1>
              <Chip>{current.detached ? "detached HEAD" : current.branch}</Chip>
            </div>
            <div className="mb-3 flex gap-1 border-b" style={{ borderColor: "var(--line)" }}>
              {(
                [
                  ["branches", "Branches"],
                  ["worktrees", "Worktrees"],
                  ["changes", "Changes"],
                ] as Array<[Tab, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  data-testid={`git-tab-${id}`}
                  className="cursor-pointer border-0 bg-transparent px-3 py-1.5"
                  style={{
                    color: "var(--text)",
                    borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
                    fontWeight: tab === id ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "branches" && <BranchesTab key={current.id} projectId={current.id} />}
            {tab === "worktrees" && <WorktreesTab key={current.id} projectId={current.id} />}
            {tab === "changes" && <DiffTab key={current.id} projectId={current.id} />}
          </>
        )}
      </div>
    </div>
  );
}
