import { GitBranchPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BranchCompare, BranchInfo } from "@shared/models";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  StatusBadge,
  Time,
  notifyDone,
  notifyError,
} from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

/** Local and remote branches: switch (with a stash offer), create, compare, delete merged ones. */
export function BranchesTab({ projectId }: { projectId: string }) {
  const branches = useQuery("branches.list", { projectId }, ["project.status"]);
  const [needStash, setNeedStash] = useState<{ name: string; remote: boolean } | null>(null);
  const [newName, setNewName] = useState("");
  const [cmp, setCmp] = useState<BranchCompare | null>(null);
  const [pick, setPick] = useState<string[]>([]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
      branches.reload();
    } catch (err) {
      notifyError(err, "That did not work", "branches");
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
          {b.current && <StatusBadge status="saved" label="Current" />}
          {b.merged && <span className="ui-muted">Merged</span>}
          {b.ahead > 0 && <StatusBadge status="ahead" label={`${b.ahead} to push`} />}
          {b.behind > 0 && <StatusBadge status="behind" label={`${b.behind} to pull`} />}
          {b.gone && <StatusBadge status="behind" label="Upstream gone" />}
        </div>
        <div className="truncate text-[length:var(--text-xs)] ui-muted">
          {b.subject} (<Time iso={b.lastCommit} />)
        </div>
      </div>
      {!b.current && (
        <Button onClick={() => void doSwitch(b.name, b.remote)} data-testid="switch-branch">
          Switch
        </Button>
      )}
      {!b.remote && !b.current && b.merged && (
        <IconButton
          label={`Delete ${b.name}`}
          onClick={() =>
            void run(() => office.invoke("branches.delete", { projectId, name: b.name }))
          }
          data-testid="delete-branch"
        >
          <Trash2 />
        </IconButton>
      )}
    </div>
  );

  const d = branches.data;
  return (
    <div className="grid gap-4" data-testid="branches-tab">
      {branches.error && <p className="ui-bad">{branches.error}</p>}
      {needStash && (
        <div className="ui-ask flex items-center gap-3" data-testid="stash-offer">
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
      <Card
        title={`Local branches${d?.defaultBranch ? ` (default: ${d.defaultBranch})` : ""}`}
        action={
          <div className="flex gap-2">
            <Button
              onClick={() =>
                void run(async () => {
                  const removed = await office.invoke("branches.cleanMerged", { projectId });
                  notifyDone(
                    removed.length
                      ? `Deleted ${removed.join(", ")}`
                      : "No merged branches to delete",
                    undefined,
                    "branches",
                  );
                })
              }
              data-testid="clean-merged"
            >
              <Trash2 /> Delete merged
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
          className="mb-3 flex items-end gap-2"
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
          <Input
            className="flex-1"
            label="New branch name"
            hideLabel
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New branch name"
            data-testid="new-branch-name"
          />
          <Button type="submit" disabled={!newName.trim()} data-testid="create-branch">
            <GitBranchPlus /> Create and switch
          </Button>
        </form>
        {d?.local.length === 0 && (
          <EmptyState title="No branches yet">Make a first commit.</EmptyState>
        )}
        {d?.local.map(row)}
      </Card>
      {cmp && (
        <Card title={`${cmp.a} vs ${cmp.b}`}>
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
            <pre className="mt-2 text-[length:var(--text-xs)]">{cmp.stat}</pre>
          </div>
        </Card>
      )}
      <Card title="Remote branches">
        {d?.remote.length === 0 && (
          <EmptyState title="No remote branches">Sync fetches them.</EmptyState>
        )}
        {d?.remote.map(row)}
      </Card>
    </div>
  );
}
