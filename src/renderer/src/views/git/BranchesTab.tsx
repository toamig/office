import { GitBranchPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BranchCompare, BranchInfo } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { timeAgo, useQuery } from "../../lib/hooks";

/** Local and remote branches: switch (with a stash offer), create, compare, delete merged ones. */
export function BranchesTab({ projectId }: { projectId: string }) {
  const branches = useQuery("branches.list", { projectId }, ["project.status"]);
  const [error, setError] = useState<string | null>(null);
  const [needStash, setNeedStash] = useState<{ name: string; remote: boolean } | null>(null);
  const [newName, setNewName] = useState("");
  const [cmp, setCmp] = useState<BranchCompare | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    setNote(null);
    try {
      await work();
      branches.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const doSwitch = (name: string, remote: boolean, stash = false): Promise<void> =>
    run(async () => {
      try {
        await office.invoke("branches.switch", { projectId, name, remote, stash });
        setNeedStash(null);
      } catch (err) {
        if ((err as Error).message.includes("Stash them first")) setNeedStash({ name, remote });
        else throw err;
      }
    });

  const toggle = (name: string): void =>
    setPick((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p.slice(-1), name]));
  const compare = (): Promise<void> =>
    run(async () => {
      const [a, b] = pick;
      if (a && b) setCmp(await office.invoke("branches.compare", { projectId, a, b }));
    });

  const row = (b: BranchInfo) => (
    <div
      key={`${b.remote}-${b.name}`}
      className="flex items-center gap-2 border-b py-1.5"
      style={{ borderColor: "var(--line)" }}
      data-testid="branch-row"
      data-branch={b.name}
    >
      <input
        type="checkbox"
        checked={pick.includes(b.name)}
        onChange={() => toggle(b.name)}
        aria-label={`Compare ${b.name}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{b.name}</span>
          {b.current && <Chip tone="good">current</Chip>}
          {b.merged && <Chip>merged</Chip>}
          {b.ahead > 0 && <Chip>{b.ahead} ahead</Chip>}
          {b.behind > 0 && <Chip>{b.behind} behind</Chip>}
          {b.gone && <Chip tone="warn">upstream gone</Chip>}
        </div>
        <div className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
          {b.subject} ({timeAgo(b.lastCommit)})
        </div>
      </div>
      {!b.current && (
        <Button onClick={() => void doSwitch(b.name, b.remote)} data-testid="switch-branch">
          Switch
        </Button>
      )}
      {!b.remote && !b.current && b.merged && (
        <Button
          variant="ghost"
          aria-label={`Delete ${b.name}`}
          onClick={() =>
            void run(() => office.invoke("branches.delete", { projectId, name: b.name }))
          }
          data-testid="delete-branch"
        >
          <Trash2 size={13} />
        </Button>
      )}
    </div>
  );

  const d = branches.data;
  return (
    <div className="grid gap-4" data-testid="branches-tab">
      {(error || branches.error) && (
        <div data-testid="branch-error">
          <ErrorBanner message={error ?? branches.error ?? ""} />
        </div>
      )}
      {needStash && (
        <div
          className="flex items-center gap-3 rounded border px-3 py-2"
          style={{ borderColor: "#c98a12" }}
          data-testid="stash-offer"
        >
          <span className="flex-1">
            There are uncommitted changes. Stash them (untracked files too) and switch to{" "}
            {needStash.name}?
          </span>
          <Button
            variant="primary"
            onClick={() => void doSwitch(needStash.name, needStash.remote, true)}
            data-testid="stash-switch"
          >
            Stash and switch
          </Button>
          <Button onClick={() => setNeedStash(null)}>Cancel</Button>
        </div>
      )}
      {note && <Chip tone="good">{note}</Chip>}
      <Panel
        title={`Local branches${d?.defaultBranch ? ` (default: ${d.defaultBranch})` : ""}`}
        action={
          <div className="flex gap-2">
            <Button
              onClick={() =>
                void run(async () => {
                  const removed = await office.invoke("branches.cleanMerged", { projectId });
                  setNote(
                    removed.length
                      ? `Deleted ${removed.join(", ")}`
                      : "No merged branches to delete",
                  );
                })
              }
              data-testid="clean-merged"
            >
              <Trash2 size={13} /> Delete merged
            </Button>
            <Button
              disabled={pick.length !== 2}
              onClick={() => void compare()}
              data-testid="compare-branches"
            >
              Compare 2
            </Button>
          </div>
        }
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await office.invoke("branches.create", {
                projectId,
                name: newName.trim(),
                switchTo: true,
              });
              setNewName("");
            });
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New branch name"
            aria-label="New branch name"
            data-testid="new-branch-name"
            className="flex-1 rounded border px-2 py-1"
            style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          />
          <Button type="submit" disabled={!newName.trim()} data-testid="create-branch">
            <GitBranchPlus size={13} /> Create and switch
          </Button>
        </form>
        {d?.local.length === 0 && <EmptyState>No branches yet. Make a first commit.</EmptyState>}
        {d?.local.map(row)}
      </Panel>
      {cmp && (
        <Panel title={`${cmp.a} vs ${cmp.b}`}>
          <div data-testid="compare-result">
            <div className="font-medium">
              Only on {cmp.a} ({cmp.onlyInA.length})
            </div>
            {cmp.onlyInA.map((c) => (
              <div key={c}>{c}</div>
            ))}
            <div className="mt-2 font-medium">
              Only on {cmp.b} ({cmp.onlyInB.length})
            </div>
            {cmp.onlyInB.map((c) => (
              <div key={c}>{c}</div>
            ))}
            <pre className="mt-2 text-[12px]">{cmp.stat}</pre>
          </div>
        </Panel>
      )}
      <Panel title="Remote branches">
        {d?.remote.length === 0 && <EmptyState>No remote branches. Sync fetches them.</EmptyState>}
        {d?.remote.map(row)}
      </Panel>
    </div>
  );
}
