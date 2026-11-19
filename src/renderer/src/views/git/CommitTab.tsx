import { GitCommitHorizontal, Upload } from "lucide-react";
import { useState } from "react";
import { Button, Card, EmptyState, Textarea, notify, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Dropdown as Select } from "../../ui";
import { VirtualList } from "../../components/VirtualList";

/** Stage the files you choose, write a message (no Co-Authored-By trailers), commit, and push. */
export function CommitTab({ projectId }: { projectId: string }) {
  const worktrees = useQuery("worktrees.list", { projectId }, ["project.status"]);
  const [dir, setDir] = useState("");
  const status = useQuery("git.status", { projectId, ...(dir ? { dir } : {}) }, ["project.status"]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const files = status.data?.files ?? [];
  const chosen = files.map((f) => f.path).filter((p) => !skipped.includes(p));
  const toggle = (path: string): void =>
    setSkipped((all) => (all.includes(path) ? all.filter((p) => p !== path) : [...all, path]));

  const commit = async (push: boolean): Promise<void> => {
    setBusy(true);
    try {
      const result = await office.invoke("commit.run", {
        projectId,
        ...(dir ? { dir } : {}),
        files: chosen,
        message,
        push,
      });
      if (push && !result.pushed)
        notify({
          tone: "attention",
          title: `Committed ${result.hash}, but the push failed`,
          detail: result.pushError ?? "Unknown error",
          subject: "commit",
        });
      else
        notify({
          tone: "success",
          title: push ? `Committed ${result.hash} and pushed` : `Committed ${result.hash}`,
          subject: "commit",
        });
      setMessage("");
      setSkipped([]);
      status.reload();
    } catch (err) {
      notifyError(err, "The commit did not go through", "commit");
    } finally {
      setBusy(false);
    }
  };
  const push = async (): Promise<void> => {
    try {
      const result = await office.invoke("git.push", { projectId, ...(dir ? { dir } : {}) });
      if (result.pushed) notify({ tone: "success", title: "Pushed", subject: "commit" });
      else
        notify({
          tone: "danger",
          title: "The push failed",
          detail: result.error ?? "Unknown error",
          subject: "commit",
        });
    } catch (err) {
      notifyError(err, "The push did not go through", "commit");
    }
    status.reload();
  };

  return (
    <div className="grid gap-3" data-testid="commit-tab">
      <Select
        value={dir}
        onChange={(e) => setDir(e.target.value)}
        aria-label="Commit in"
        data-testid="commit-dir"
        className="w-fit"
      >
        <option value="">Project folder</option>
        {(worktrees.data ?? [])
          .filter((w) => w.kind !== "main")
          .map((w) => (
            <option key={w.path} value={w.path}>
              Worktree: {w.branch ?? w.path}
            </option>
          ))}
      </Select>
      {status.error && <p className="ui-bad">{status.error}</p>}
      <Card
        title={`Changed files (${chosen.length} of ${files.length} chosen)`}
        action={
          (status.data?.ahead ?? 0) > 0 ? (
            <Button onClick={() => void push()} data-testid="push-only">
              <Upload /> Push {status.data?.ahead} {status.data?.ahead === 1 ? "commit" : "commits"}
            </Button>
          ) : undefined
        }
      >
        {files.length === 0 && (
          <EmptyState title="Nothing to commit">The working tree is clean.</EmptyState>
        )}
        <VirtualList
          testId="commit-files"
          items={files}
          estimate={26}
          itemKey={(f) => f.path}
          renderItem={(f) => (
            <label className="flex items-center gap-2 py-0.5" data-testid="commit-file">
              <input
                type="checkbox"
                checked={!skipped.includes(f.path)}
                onChange={() => toggle(f.path)}
              />
              <span className="font-mono text-[length:var(--text-xs)] ui-muted">
                {f.index}
                {f.worktree}
              </span>
              {f.path}
            </label>
          )}
        />
      </Card>
      <Textarea
        label="Commit message"
        hideLabel
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        placeholder="Commit message. Commit messages never carry a Co-Authored-By trailer."
        data-testid="commit-message"
      />
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || chosen.length === 0 || !message.trim()}
          onClick={() => void commit(false)}
          data-testid="commit-only"
        >
          <GitCommitHorizontal /> Commit
        </Button>
        <Button
          disabled={busy || chosen.length === 0 || !message.trim()}
          onClick={() => void commit(true)}
          data-testid="commit-push"
        >
          Commit and push
        </Button>
      </div>
    </div>
  );
}
