import { GitBranch } from "lucide-react";
import { useState } from "react";
import { PrsPanel } from "../components/PrsPanel";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";
import { EmptyState, Group, Page, SplitPane, StatusBadge, Tabs } from "../ui";
import { BranchesTab } from "./git/BranchesTab";
import { CommitTab } from "./git/CommitTab";
import { DiffTab } from "./git/DiffTab";
import { WorktreesTab } from "./git/WorktreesTab";

const TABS = ["branches", "worktrees", "changes", "commit", "prs"] as const;
type Tab = (typeof TABS)[number];

/** The Git desk: every repo at a glance, and branches, worktrees, diffs, commits and PRs for the chosen one. */
export function Git() {
  const params = useUi((s) => s.params);
  const projects = useQuery("projects.list", undefined, ["project.status"]);
  const health = useQuery("vault.health", undefined, ["vault.health"]);
  const [selected, setSelected] = useState(params["project"] ?? "");
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t === params["tab"]) ?? "branches");

  const repos = (projects.data ?? []).filter((p) => !p.archived && p.isRepo);
  const current = repos.find((p) => p.id === selected) ?? repos[0];
  const brain = health.data?.repos ?? [];

  const list = (
    <div className="p-2">
      <Group>Project repos</Group>
      {repos.length === 0 && (
        <EmptyState title="No git repos yet">
          Your projects that are git repos show here.
        </EmptyState>
      )}
      {repos.map((p) => (
        <div
          key={p.id}
          data-testid="git-repo"
          className="ui-row"
          role="button"
          tabIndex={0}
          data-clickable="true"
          data-selected={current?.id === p.id ? "true" : undefined}
          onClick={() => setSelected(p.id)}
          onKeyDown={(e) => e.key === "Enter" && setSelected(p.id)}
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium">{p.name}</div>
            <div className="ui-badges ui-line-sub">
              <span>{p.detached ? "Detached HEAD" : p.branch}</span>
              {p.changed > 0 && <StatusBadge status="unsaved" label={`${p.changed} changed`} />}
              {p.ahead > 0 && <StatusBadge status="ahead" label={`${p.ahead} to push`} />}
              {p.behind > 0 && <StatusBadge status="behind" label={`${p.behind} to pull`} />}
            </div>
          </div>
        </div>
      ))}
      {brain.length > 0 && (
        <>
          <Group>Brain repos</Group>
          {brain.map((r) => (
            <div key={r.folder} className="ui-row" data-testid="brain-repo">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span>{r.folder === "." ? "Hub" : r.folder}</span>
                  {r.branch && (
                    <span className="ui-line-sub flex items-center gap-1">
                      <GitBranch size={14} />
                      {r.branch}
                    </span>
                  )}
                </div>
                <div className="ui-badges ui-line-sub">
                  {r.uncommitted > 0 && (
                    <StatusBadge status="unsaved" label={`${r.uncommitted} changed`} />
                  )}
                  {r.ahead > 0 && <StatusBadge status="ahead" label={`${r.ahead} to push`} />}
                  {r.behind > 0 && <StatusBadge status="behind" label={`${r.behind} to pull`} />}
                  {r.uncommitted === 0 && r.ahead === 0 && r.behind === 0 && (
                    <span className={r.attention ? "ui-warn" : "ui-muted"}>{r.state}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );

  const detail = (
    <div className="grid content-start gap-4 p-4">
      {!current && (
        <EmptyState title="Pick a repo">
          Choose one on the left to see its branches and changes.
        </EmptyState>
      )}
      {current && (
        <>
          <div className="flex items-center gap-3">
            <h2 className="m-0 text-[length:var(--text-lg)]">{current.name}</h2>
            <span className="ui-muted flex items-center gap-1">
              <GitBranch size={14} />
              {current.detached ? "Detached HEAD" : current.branch}
            </span>
          </div>
          <Tabs
            label="Git sections"
            value={tab}
            onChange={setTab}
            items={[
              { id: "branches", label: "Branches", testId: "git-tab-branches" },
              { id: "worktrees", label: "Worktrees", testId: "git-tab-worktrees" },
              { id: "changes", label: "Changes", testId: "git-tab-changes" },
              { id: "commit", label: "Commit", testId: "git-tab-commit" },
              { id: "prs", label: "Pull requests and CI", testId: "git-tab-prs" },
            ]}
          />
          {tab === "branches" && <BranchesTab key={current.id} projectId={current.id} />}
          {tab === "worktrees" && <WorktreesTab key={current.id} projectId={current.id} />}
          {tab === "changes" && <DiffTab key={current.id} projectId={current.id} />}
          {tab === "commit" && <CommitTab key={current.id} projectId={current.id} />}
          {tab === "prs" && <PrsPanel key={current.id} projectId={current.id} />}
        </>
      )}
    </div>
  );

  return (
    <Page title="Git" testId="git" fill>
      <SplitPane
        id="git"
        defaultSize={340}
        min={260}
        minSecond={480}
        first={list}
        second={detail}
      />
    </Page>
  );
}
