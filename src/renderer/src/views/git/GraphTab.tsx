import { GitBranch, GitFork, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { foldLanes } from "@shared/graph-lanes";
import type { BranchCompare, BranchInfo, GraphLabel, GraphRow, WorktreeInfo } from "@shared/models";
import { InspectorSlot } from "../../components/Inspector";
import { VirtualList } from "../../components/VirtualList";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import {
  Banner,
  Button,
  Card,
  Dialog,
  EmptyState,
  Group,
  Input,
  OverflowMenu,
  StatusBadge,
  Time,
  notifyError,
} from "../../ui";
import { BranchesTab } from "./BranchesTab";
import { WorktreesTab } from "./WorktreesTab";

const LANE_W = 16;
const ROW_H = 34;
const PAD = 12;
/** The colour classes of lanes: the design system's own tones, taken in turn. */
const LANE_COLORS = 6;
const PAGE = 300;
/** Past this many lanes the rest are folded into one, so the commit text always has room. */
const LANE_CAP = 12;

/** The lines and the dot of one commit: lanes that arrive from above, pass by, or leave below. */
function Lines({
  row,
  width,
  laneW,
  here,
}: {
  row: GraphRow;
  width: number;
  laneW: number;
  here: boolean;
}) {
  const cy = ROW_H / 2;
  const laneX = (lane: number): number => PAD + lane * laneW;
  const w = PAD * 2 + Math.max(0, width - 1) * laneW;
  return (
    <svg
      className="graph-lines"
      width={w}
      height={ROW_H}
      viewBox={`0 0 ${w} ${ROW_H}`}
      aria-hidden
      data-testid="graph-lines"
    >
      {row.through.map((t) => (
        <line
          key={`t${t.lane}`}
          className={`graph-c${t.color % LANE_COLORS}`}
          x1={laneX(t.lane)}
          y1={0}
          x2={laneX(t.lane)}
          y2={ROW_H}
        />
      ))}
      {row.fromAbove.map((f) => (
        <path
          key={`f${f.lane}`}
          className={`graph-c${f.color % LANE_COLORS}`}
          data-fork={row.fromAbove.length > 1 ? "true" : undefined}
          d={`M ${laneX(f.lane)} 0 C ${laneX(f.lane)} ${cy}, ${laneX(row.col)} 0, ${laneX(row.col)} ${cy}`}
        />
      ))}
      {row.toBelow.map((t, i) => (
        <path
          key={`b${i}`}
          className={`graph-c${t.color % LANE_COLORS}`}
          data-join={row.toBelow.length > 1 ? "true" : undefined}
          d={`M ${laneX(row.col)} ${cy} C ${laneX(row.col)} ${ROW_H}, ${laneX(t.to)} ${cy}, ${laneX(t.to)} ${ROW_H}`}
        />
      ))}
      <circle
        className={`graph-dot graph-c${row.color % LANE_COLORS}`}
        data-here={here ? "true" : undefined}
        cx={laneX(row.col)}
        cy={cy}
        r={here ? 6 : 5}
      />
    </svg>
  );
}

/** One branch name at a commit: a menu of what can be done with the branch. */
function BranchLabel({
  label,
  projectId,
  info,
  worktree,
  current,
  onSwitch,
  onCompare,
}: {
  label: GraphLabel;
  projectId: string;
  info: BranchInfo | undefined;
  worktree: WorktreeInfo | undefined;
  current: string | null;
  onSwitch: (name: string) => void;
  onCompare: (a: string, b: string) => void;
}) {
  const navigate = useUi((s) => s.navigate);
  const deletable = info !== undefined && info.merged && !info.current;
  return (
    <span className="graph-label" data-testid="graph-branch" data-branch={label.name}>
      <OverflowMenu
        trigger={label.name}
        floating
        size="sm"
        testId={`branch-menu-${label.name}`}
        items={[
          ...(label.current
            ? []
            : [
                {
                  label: "Switch to it",
                  testId: "branch-switch",
                  onSelect: () => onSwitch(label.name),
                },
              ]),
          ...(current && current !== label.name
            ? [
                {
                  label: `Compare with ${current}`,
                  testId: "branch-compare",
                  onSelect: () => onCompare(current, label.name),
                },
              ]
            : []),
          ...(worktree
            ? [
                {
                  label: "Open its worktree",
                  hint: "Starts a session in that folder",
                  testId: "branch-worktree",
                  onSelect: () =>
                    navigate("agents", { start: "1", project: projectId, cwd: worktree.path }),
                },
              ]
            : []),
          ...(deletable
            ? [
                {
                  label: "Delete it (it is merged)",
                  danger: true,
                  testId: "branch-delete",
                  onSelect: () =>
                    void office
                      .invoke("branches.delete", { projectId, name: label.name })
                      .catch((err: unknown) =>
                        notifyError(err, `Could not delete ${label.name}`, "branches"),
                      ),
                },
              ]
            : []),
        ]}
      />
      {worktree && (
        <span
          className="graph-mark"
          title={`Worktree: ${worktree.path}`}
          data-testid="graph-worktree"
        >
          <GitFork size={13} aria-label="Has a worktree" />
        </span>
      )}
      {info && info.ahead > 0 && <StatusBadge status="ahead" label={`${info.ahead} to push`} />}
      {info && info.behind > 0 && <StatusBadge status="behind" label={`${info.behind} to pull`} />}
    </span>
  );
}

/**
 * The Git desk's main view of a repo: a vertical graph of its branches, newest at the top. Each branch is a lane in
 * its own colour, a commit a dot, a fork where a branch started and a join where one was merged; names sit at the
 * heads, worktrees are marked on their branch, and HEAD says "You are here". Beside it, the branch and worktree
 * lists are filters; the tools to make and clean them are one click away.
 */
export function GraphTab({ projectId }: { projectId: string }) {
  const [limit, setLimit] = useState(PAGE);
  const graph = useQuery("git.graph", { projectId, limit }, ["project.status"]);
  const branches = useQuery("branches.list", { projectId }, ["project.status"]);
  const worktrees = useQuery("worktrees.list", { projectId }, ["project.status"]);
  const [selected, setSelected] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [only, setOnly] = useState<"all" | "worktree">("all");
  const [remote, setRemote] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const [tools, setTools] = useState(false);
  const [stash, setStash] = useState<string | null>(null);
  const [cmp, setCmp] = useState<BranchCompare | null>(null);
  // A narrow desk keeps the filters out of the way until they are asked for.
  const tab = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const el = tab.current;
    if (!el) return;
    const watch = new ResizeObserver(([e]) => setNarrow((e?.contentRect.width ?? 0) < 760));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const g = graph.data;
  const [expanded, setExpanded] = useState(false);
  const laid = useMemo(
    () =>
      g
        ? expanded
          ? { rows: g.rows, width: g.width, hidden: 0 }
          : foldLanes(g.rows, g.width, LANE_CAP)
        : null,
    [g, expanded],
  );
  const manyLanes = g !== undefined && g.width > LANE_CAP + 1;
  // Unfolded, every lane squeezes into the room the folded graph takes, so the text column stays where it is.
  const fixedPx = PAD * 2 + LANE_CAP * LANE_W;
  const laneW = expanded
    ? Math.max(
        2,
        Math.min(LANE_W, Math.floor((fixedPx - PAD * 2) / Math.max(1, (laid?.width ?? 1) - 1))),
      )
    : LANE_W;
  const lanesPx = expanded
    ? Math.max(fixedPx, PAD * 2 + Math.max(0, (laid?.width ?? 1) - 1) * laneW)
    : PAD * 2 + Math.max(0, (laid?.width ?? 1) - 1) * LANE_W;
  const infoOf = (name: string): BranchInfo | undefined =>
    branches.data?.local.find((b) => b.name === name);
  const worktreeOf = (name: string): WorktreeInfo | undefined =>
    worktrees.data?.find((w) => w.branch === name && w.kind !== "main");
  const withTree = new Set(
    (worktrees.data ?? []).flatMap((w) => (w.branch && w.kind !== "main" ? [w.branch] : [])),
  );

  const doSwitch = async (name: string, withStash = false): Promise<void> => {
    try {
      await office.invoke("branches.switch", { projectId, name, remote: false, stash: withStash });
      setStash(null);
      graph.reload();
      branches.reload();
    } catch (err) {
      if ((err as Error).message.includes("Stash them first")) setStash(name);
      else notifyError(err, `Could not switch to ${name}`, "branches");
    }
  };
  const compare = async (a: string, b: string): Promise<void> => {
    try {
      setCmp(await office.invoke("branches.compare", { projectId, a, b }));
    } catch (err) {
      notifyError(err, "Could not compare those branches", "branches");
    }
  };

  const shown = (branches.data?.local ?? []).filter(
    (b) =>
      b.name.toLowerCase().includes(find.trim().toLowerCase()) &&
      (only === "all" || withTree.has(b.name)),
  );
  const chosen = g?.rows.find((r) => r.hash === selected) ?? null;
  const here = g?.head.hash ?? null;

  const focusBranch = (name: string): void => {
    setFocus(name);
    const row = document.querySelector(`[data-branch-head="${CSS.escape(name)}"]`);
    row?.scrollIntoView({ block: "center" });
  };

  return (
    <div className="graph-tab" data-testid="graph-tab" ref={tab}>
      {graph.error && (
        <Banner tone="danger" testId="graph-error">
          <span className="flex flex-wrap items-center gap-3">
            <span>{graph.error}</span>
            <Button size="sm" onClick={graph.reload} data-testid="graph-retry">
              Try again
            </Button>
          </span>
        </Banner>
      )}
      {stash && (
        <div className="ui-ask flex items-center gap-3" data-testid="stash-offer">
          <span className="flex-1">
            There are uncommitted changes. Stash them (untracked files too) and switch to {stash}?
          </span>
          <Button
            variant="primary"
            onClick={() => void doSwitch(stash, true)}
            data-testid="stash-switch"
          >
            Stash and switch
          </Button>
          <Button onClick={() => setStash(null)}>Cancel</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {narrow && (
          <Button
            size="sm"
            onClick={() => setFiltersOpen(!filtersOpen)}
            data-testid="graph-filters-toggle"
          >
            {filtersOpen ? "Hide branches and worktrees" : "Branches and worktrees"}
          </Button>
        )}
        <Button size="sm" onClick={() => setTools(true)} data-testid="graph-tools">
          <Wrench /> Branch tools
        </Button>
      </div>
      <div className="graph-layout" data-narrow={narrow ? "true" : undefined}>
        {(!narrow || filtersOpen) && (
          <aside className="graph-filters" data-testid="graph-filters" aria-label="Filters">
            <Input
              label="Find a branch"
              hideLabel
              placeholder="Find a branch"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              data-testid="graph-find"
            />
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={only === "worktree"}
                  onChange={(e) => setOnly(e.target.checked ? "worktree" : "all")}
                  data-testid="graph-only-worktrees"
                />{" "}
                With a worktree
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={remote}
                  onChange={(e) => setRemote(e.target.checked)}
                  data-testid="graph-remotes"
                />{" "}
                Remote branches
              </label>
            </div>
            <Group>Branches</Group>
            {shown.length === 0 && <p className="ui-muted m-0">No branch matches.</p>}
            {shown.map((b) => (
              <button
                key={b.name}
                type="button"
                className="graph-filter-row"
                data-active={focus === b.name ? "true" : undefined}
                onClick={() => focusBranch(b.name)}
                data-testid="graph-filter-branch"
              >
                <GitBranch size={13} aria-hidden />
                <span className="truncate">{b.name}</span>
                {b.current && <span className="ui-muted">current</span>}
                {withTree.has(b.name) && <GitFork size={13} aria-label="Has a worktree" />}
              </button>
            ))}
            <Group>Worktrees</Group>
            {(worktrees.data ?? []).filter((w) => w.kind !== "main").length === 0 && (
              <p className="ui-muted m-0">No other worktrees.</p>
            )}
            {(worktrees.data ?? [])
              .filter((w) => w.kind !== "main")
              .map((w) => (
                <button
                  key={w.path}
                  type="button"
                  className="graph-filter-row"
                  onClick={() => w.branch && focusBranch(w.branch)}
                  title={w.path}
                  data-testid="graph-filter-worktree"
                >
                  <GitFork size={13} aria-hidden />
                  <span className="truncate">{w.branch ?? "detached"}</span>
                  {w.dirty > 0 && <span className="ui-muted">{w.dirty} changed</span>}
                </button>
              ))}
          </aside>
        )}
        <div
          className="graph-main"
          data-testid="graph-main"
          style={{ "--graph-lanes": `${lanesPx}px` } as React.CSSProperties}
        >
          {manyLanes && (
            <div className="graph-lanes-bar">
              <Button
                size="sm"
                onClick={() => setExpanded(!expanded)}
                data-testid="graph-lanes-toggle"
              >
                {expanded
                  ? "Fold the extra branches"
                  : `+${(g?.width ?? 0) - LANE_CAP - 1} branches`}
              </Button>
              <span className="ui-muted">
                {expanded ? `All ${g?.width} lanes` : `Showing the first ${LANE_CAP} lanes`}
              </span>
            </div>
          )}
          {g && g.rows.length === 0 && !graph.error && (
            <EmptyState title="No commits yet">
              Make a commit and its history draws here.
            </EmptyState>
          )}
          {laid && laid.rows.length > 0 && (
            <VirtualList
              items={laid.rows}
              estimate={ROW_H}
              itemKey={(r) => r.hash}
              testId="graph-list"
              renderItem={(row) => {
                const labels = row.labels.filter((l) => remote || l.kind !== "remote");
                const isHere = row.hash === here;
                const headBranch = labels.find((l) => l.kind === "branch")?.name;
                return (
                  <div
                    className="graph-row"
                    data-testid="graph-row"
                    data-hash={row.hash}
                    data-selected={selected === row.hash ? "true" : undefined}
                    data-focus={labels.some((l) => l.name === focus) ? "true" : undefined}
                    data-branch-head={headBranch}
                    onClick={() => setSelected(row.hash)}
                  >
                    <Lines row={row} width={laid.width} laneW={laneW} here={isHere} />
                    <div className="graph-text">
                      {isHere && (
                        <span className="graph-here" data-testid="graph-here">
                          You are here
                        </span>
                      )}
                      {labels.map((l) =>
                        l.kind === "branch" ? (
                          <BranchLabel
                            key={`b-${l.name}`}
                            label={l}
                            projectId={projectId}
                            info={infoOf(l.name)}
                            worktree={worktreeOf(l.name)}
                            current={g?.head.branch ?? null}
                            onSwitch={(n) => void doSwitch(n)}
                            onCompare={(a, b) => void compare(a, b)}
                          />
                        ) : (
                          <span
                            key={`${l.kind}-${l.name}`}
                            className="graph-tag"
                            data-kind={l.kind}
                            data-testid={`graph-${l.kind}`}
                          >
                            {l.kind === "head" ? "HEAD (detached)" : l.name}
                          </span>
                        ),
                      )}
                      <span className="graph-subject truncate">{row.subject}</span>
                    </div>
                  </div>
                );
              }}
            />
          )}
          {g?.hasMore && (
            <div className="p-2">
              <Button onClick={() => setLimit(limit + PAGE)} data-testid="graph-more">
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
      <InspectorSlot view="git">
        {chosen && (
          <Card title={chosen.subject} testId="commit-inspector">
            <dl className="ui-dl">
              <dt>Commit</dt>
              <dd className="num">{chosen.short}</dd>
              <dt>Author</dt>
              <dd>{chosen.author}</dd>
              <dt>When</dt>
              <dd>
                <Time iso={new Date(chosen.at * 1000).toISOString()} />
              </dd>
              <dt>{chosen.parents.length > 1 ? "Parents" : "Parent"}</dt>
              <dd className="num">
                {chosen.parents.length === 0
                  ? "None, it is the first commit"
                  : chosen.parents.map((p) => p.slice(0, 7)).join(", ")}
              </dd>
              {chosen.labels.length > 0 && (
                <>
                  <dt>Names</dt>
                  <dd>{chosen.labels.map((l) => l.name).join(", ")}</dd>
                </>
              )}
            </dl>
          </Card>
        )}
      </InspectorSlot>
      {cmp && (
        <Dialog
          title={`${cmp.a} and ${cmp.b}`}
          testId="graph-compare"
          wide
          onClose={() => setCmp(null)}
          footer={<Button onClick={() => setCmp(null)}>Close</Button>}
        >
          <div className="grid gap-3">
            <div>
              <Group>Only in {cmp.a}</Group>
              {cmp.onlyInA.length === 0 && <p className="ui-muted m-0">Nothing.</p>}
              {cmp.onlyInA.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
            <div>
              <Group>Only in {cmp.b}</Group>
              {cmp.onlyInB.length === 0 && <p className="ui-muted m-0">Nothing.</p>}
              {cmp.onlyInB.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
            {cmp.stat && <pre className="ui-codeblock m-0">{cmp.stat}</pre>}
          </div>
        </Dialog>
      )}
      {tools && (
        <Dialog
          title="Branch tools"
          testId="branch-tools"
          wide
          onClose={() => {
            setTools(false);
            graph.reload();
          }}
          footer={<Button onClick={() => setTools(false)}>Close</Button>}
        >
          <div className="grid gap-4">
            <BranchesTab projectId={projectId} />
            <WorktreesTab projectId={projectId} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
