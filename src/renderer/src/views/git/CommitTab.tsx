import { GitCommitHorizontal, Upload } from "lucide-react";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Select } from "../../components/Select";

/** Stage the files you choose, write a message (no Co-Authored-By trailers), commit, and push. */
export function CommitTab({ projectId }: { projectId: string }) {
  const worktrees = useQuery("worktrees.list", { projectId }, ["project.status"]);
  const [dir, setDir] = useState("");
  const status = useQuery("git.status", { projectId, ...(dir ? { dir } : {}) }, ["project.status"]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const files = status.data?.files ?? [];
  const chosen = files.map((f) => f.path).filter((p) => !skipped.includes(p));
  const toggle = (path: string): void =>
    setSkipped((all) => (all.includes(path) ? all.filter((p) => p !== path) : [...all, path]));

  const commit = async (push: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await office.invoke("commit.run", {
        projectId,
        ...(dir ? { dir } : {}),
        files: chosen,
        message,
        push,
      });
      setNote(
        push
          ? result.pushed
            ? `Committed ${result.hash} and pushed.`
            : `Committed ${result.hash}, but the push failed: ${result.pushError ?? "unknown error"}`
          : `Committed ${result.hash}.`,
      );
      setMessage("");
      setSkipped([]);
      status.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const push = async (): Promise<void> => {
    setError(null);
    const result = await office.invoke("git.push", { projectId, ...(dir ? { dir } : {}) });
    setNote(result.pushed ? "Pushed." : `Push failed: ${result.error ?? "unknown error"}`);
    status.reload();
  };

  return (
    <div className="grid gap-3" data-testid="commit-tab">
      <Select
        value={dir}
        onChange={(e) => setDir(e.target.value)}
        aria-label="Commit in"
        data-testid="commit-dir"
        className="w-fit rounded border px-1 py-0.5"
        style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--text)" }}
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
      {(error || status.error) && (
        <div data-testid="commit-error">
          <ErrorBanner message={error ?? status.error ?? ""} />
        </div>
      )}
      {note && (
        <div data-testid="commit-note">
          <Chip tone={note.includes("failed") ? "warn" : "good"}>{note}</Chip>
        </div>
      )}
      <Panel
        title={`Changed files (${chosen.length} of ${files.length} chosen)`}
        action={
          (status.data?.ahead ?? 0) > 0 ? (
            <Button onClick={() => void push()} data-testid="push-only">
              <Upload size={13} /> Push {status.data?.ahead} commit(s)
            </Button>
          ) : undefined
        }
      >
        {files.length === 0 && (
          <EmptyState>Nothing to commit. The working tree is clean.</EmptyState>
        )}
        <div data-testid="commit-files">
          {files.map((f) => (
            <label
              key={f.path}
              className="flex items-center gap-2 py-0.5"
              data-testid="commit-file"
            >
              <input
                type="checkbox"
                checked={!skipped.includes(f.path)}
                onChange={() => toggle(f.path)}
              />
              <span className="font-mono text-[12px]" style={{ color: "var(--muted)" }}>
                {f.index}
                {f.worktree}
              </span>
              {f.path}
            </label>
          ))}
        </div>
      </Panel>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        placeholder="Commit message. Commit messages never carry a Co-Authored-By trailer."
        aria-label="Commit message"
        data-testid="commit-message"
        className="rounded border px-2 py-1"
        style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
      />
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || chosen.length === 0 || !message.trim()}
          onClick={() => void commit(false)}
          data-testid="commit-only"
        >
          <GitCommitHorizontal size={13} /> Commit
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
