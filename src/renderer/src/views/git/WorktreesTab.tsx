import { Play, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  StatusBadge,
  notifyDone,
  notifyError,
} from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { useUi } from "../../stores/ui";

/** Worktrees of one repo, including the ones other tools made: make one per task, open an agent in it, clean up. */
export function WorktreesTab({ projectId }: { projectId: string }) {
  const navigate = useUi((s) => s.navigate);
  const list = useQuery("worktrees.list", { projectId }, ["project.status"]);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  const run = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
      list.reload();
    } catch (err) {
      notifyError(err, "That did not work", "worktrees");
    }
  };

  return (
    <div className="grid gap-4" data-testid="worktrees-tab">
      {list.error && <p className="ui-bad">{list.error}</p>}
      <Card
        title="Worktrees"
        action={
          <Button
            onClick={() =>
              void run(async () => {
                const removed = await office.invoke("worktrees.cleanMerged", { projectId });
                notifyDone(
                  removed.length ? `Removed ${removed.join(", ")}` : "No merged worktrees to clean",
                  undefined,
                  "worktrees",
                );
              })
            }
            data-testid="clean-worktrees"
          >
            <Trash2 /> Clean merged
          </Button>
        }
      >
        <form
          className="mb-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await office.invoke("worktrees.create", { projectId, name: name.trim() });
              setName("");
            });
          }}
        >
          <Input
            className="flex-1"
            label="New worktree name"
            hideLabel
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New worktree for a task, for example: fix login bug"
            data-testid="new-worktree-name"
          />
          <Button type="submit" disabled={!name.trim()} data-testid="create-worktree">
            Make worktree
          </Button>
        </form>
        {list.data?.length === 0 && (
          <EmptyState title="No worktrees">Make one for a task above.</EmptyState>
        )}
        {list.data?.map((w) => (
          <div
            key={w.path}
            className="flex items-center gap-2 border-b py-2"
            data-testid="worktree-row"
            data-kind={w.kind}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{w.branch ?? "detached HEAD"}</span>
                <span className="ui-muted">
                  {w.kind === "claude"
                    ? "Claude app"
                    : w.kind === "office"
                      ? "Made by Office"
                      : w.kind === "main"
                        ? "Main folder"
                        : "Other tool"}
                </span>
                {w.dirty > 0 && <StatusBadge status="unsaved" label={`${w.dirty} changed`} />}
                {w.locked && <StatusBadge status="behind" label="Locked" />}
              </div>
              <div className="break-all text-[length:var(--text-xs)] ui-muted">{w.path}</div>
            </div>
            <Button
              onClick={() => navigate("agents", { project: projectId, start: "1", cwd: w.path })}
              data-testid="agent-in-worktree"
            >
              <Play /> Agent here
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
                <IconButton
                  label="Remove worktree"
                  onClick={() =>
                    w.kind === "office"
                      ? void run(() =>
                          office.invoke("worktrees.remove", { projectId, path: w.path }),
                        )
                      : setConfirm(w.path)
                  }
                  data-testid="remove-worktree"
                >
                  <Trash2 />
                </IconButton>
              ))}
          </div>
        ))}
        {confirm && (
          <p className="mb-0 mt-2 text-[length:var(--text-sm)] ui-warn">
            This worktree was made by another tool. Confirm to remove it.
          </p>
        )}
      </Card>
    </div>
  );
}
