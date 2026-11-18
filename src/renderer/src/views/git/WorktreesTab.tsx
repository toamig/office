import { Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { useUi } from "../../stores/ui";

/** Worktrees of one repo, including the ones other tools made: make one per task, open an agent in it, clean up. */
export function WorktreesTab({ projectId }: { projectId: string }) {
  const navigate = useUi((s) => s.navigate);
  const list = useQuery("worktrees.list", { projectId }, ["project.status"]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    setNote(null);
    try {
      await work();
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid gap-4" data-testid="worktrees-tab">
      {(error || list.error) && (
        <div data-testid="worktree-error">
          <ErrorBanner message={error ?? list.error ?? ""} />
        </div>
      )}
      {note && <Chip tone="good">{note}</Chip>}
      <Panel
        title="Worktrees"
        action={
          <Button
            onClick={() =>
              void run(async () => {
                const removed = await office.invoke("worktrees.cleanMerged", { projectId });
                setNote(
                  removed.length
                    ? `Removed ${removed.join(", ")}`
                    : "No merged Office worktrees to clean",
                );
              })
            }
            data-testid="clean-worktrees"
          >
            <Trash2 size={13} /> Clean merged
          </Button>
        }
      >
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await office.invoke("worktrees.create", { projectId, name: name.trim() });
              setName("");
            });
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New worktree for a task, for example: fix login bug"
            aria-label="New worktree name"
            data-testid="new-worktree-name"
            className="flex-1 rounded border px-2 py-1"
            style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
          />
          <Button type="submit" disabled={!name.trim()} data-testid="create-worktree">
            Make worktree
          </Button>
        </form>
        {list.data?.length === 0 && <EmptyState>No worktrees.</EmptyState>}
        {list.data?.map((w) => (
          <div
            key={w.path}
            className="flex items-center gap-2 border-b py-2"
            style={{ borderColor: "var(--line)" }}
            data-testid="worktree-row"
            data-kind={w.kind}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{w.branch ?? "detached HEAD"}</span>
                <Chip>{w.kind === "claude" ? "Claude app" : w.kind}</Chip>
                {w.dirty > 0 && <Chip tone="warn">{w.dirty} changed</Chip>}
                {w.locked && <Chip tone="warn">locked</Chip>}
              </div>
              <div className="break-all text-[12px]" style={{ color: "var(--muted)" }}>
                {w.path}
              </div>
            </div>
            <Button
              onClick={() => navigate("agents", { project: projectId, start: "1", cwd: w.path })}
              data-testid="agent-in-worktree"
            >
              <Play size={13} /> Agent here
            </Button>
            {w.kind !== "main" &&
              (confirm === w.path ? (
                <Button
                  variant="primary"
                  onClick={() =>
                    void run(async () => {
                      await office.invoke("worktrees.remove", {
                        projectId,
                        path: w.path,
                        confirmOther: true,
                      });
                      setConfirm(null);
                    })
                  }
                  data-testid="confirm-remove-worktree"
                >
                  Yes, remove it
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  aria-label="Remove worktree"
                  onClick={() =>
                    w.kind === "office"
                      ? void run(() =>
                          office.invoke("worktrees.remove", { projectId, path: w.path }),
                        )
                      : setConfirm(w.path)
                  }
                  data-testid="remove-worktree"
                >
                  <Trash2 size={13} />
                </Button>
              ))}
          </div>
        ))}
        {confirm && (
          <p className="mb-0 mt-2 text-[12.5px]" style={{ color: "var(--warn)" }}>
            This worktree was made by another tool. Confirm to remove it.
          </p>
        )}
      </Panel>
    </div>
  );
}
