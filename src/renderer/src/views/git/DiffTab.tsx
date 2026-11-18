import { MessageSquarePlus, Send, X } from "lucide-react";
import { useState } from "react";
import type { DiffFile, ReviewComment } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

type Mode = "working" | "staged" | "branch";

const bg = {
  add: "color-mix(in srgb, var(--good) 16%, transparent)",
  del: "color-mix(in srgb, var(--bad) 16%, transparent)",
  ctx: "transparent",
} as const;

/** Changed files and a unified diff with line comments that can go back to the agent that made the change. */
export function DiffTab({ projectId }: { projectId: string }) {
  const worktrees = useQuery("worktrees.list", { projectId }, ["project.status"]);
  const branches = useQuery("branches.list", { projectId });
  const [dir, setDir] = useState("");
  const [mode, setMode] = useState<Mode>("working");
  const [base, setBase] = useState("");
  const baseName = base || branches.data?.defaultBranch || "main";
  const diff = useQuery(
    "diff.get",
    { projectId, mode, ...(dir ? { dir } : {}), ...(mode === "branch" ? { base: baseName } : {}) },
    ["project.status"],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [editing, setEditing] = useState<{ file: string; line: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const files = diff.data?.files ?? [];
  const file: DiffFile | undefined = files.find((f) => f.path === selected) ?? files[0];

  const addComment = (): void => {
    if (!editing || !draft.trim()) return;
    setComments((all) => [...all, { file: editing.file, line: editing.line, text: draft.trim() }]);
    setEditing(null);
    setDraft("");
  };
  const send = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const result = await office.invoke("diff.sendComments", {
        projectId,
        ...(dir ? { dir } : {}),
        comments,
      });
      setMessage(
        result.started
          ? "Started a builder session with your comments."
          : "Sent your comments to the running agent.",
      );
      setComments([]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid gap-3" data-testid="diff-tab">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          aria-label="Checkout"
          data-testid="diff-dir"
          className="rounded border px-1 py-0.5"
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
        </select>
        {(["working", "staged", "branch"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input
              type="radio"
              checked={mode === m}
              onChange={() => setMode(m)}
              data-testid={`diff-mode-${m}`}
            />
            {m === "working" ? "Uncommitted" : m === "staged" ? "Staged" : "Branch vs base"}
          </label>
        ))}
        {mode === "branch" && (
          <select
            value={baseName}
            onChange={(e) => setBase(e.target.value)}
            aria-label="Base branch"
            className="rounded border px-1 py-0.5"
            style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--text)" }}
          >
            {(branches.data?.local ?? []).map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {(diff.error || error) && <ErrorBanner message={diff.error ?? error ?? ""} />}
      {message && (
        <div data-testid="review-sent">
          <Chip tone="good">{message}</Chip>
        </div>
      )}
      {files.length === 0 && !diff.loading && <EmptyState>No changes to review here.</EmptyState>}
      {files.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
          <div
            className="rounded border"
            style={{ borderColor: "var(--line)", background: "var(--panel)" }}
            data-testid="diff-files"
          >
            {files.map((f) => (
              <div
                key={f.path}
                data-testid="diff-file"
                onClick={() => setSelected(f.path)}
                className="border-b px-2 py-1.5"
                style={{
                  borderColor: "var(--line)",
                  background: file?.path === f.path ? "var(--rail)" : "transparent",
                }}
              >
                <div className="truncate font-medium">{f.path}</div>
                <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {f.status}
                  {f.binary ? ", binary" : ` +${f.additions} -${f.deletions}`}
                </div>
              </div>
            ))}
          </div>
          <div
            className="min-w-0 rounded border"
            style={{ borderColor: "var(--line)", background: "var(--panel)" }}
            data-testid="diff-view"
          >
            {file?.binary && <EmptyState>Binary file.</EmptyState>}
            {file?.hunks.map((h) => (
              <div key={h.header} className="font-mono text-[12.5px]">
                <div
                  className="px-2 py-0.5"
                  style={{ color: "var(--muted)", background: "var(--rail)" }}
                >
                  {h.header}
                </div>
                {h.lines.map((l, index) => {
                  const lineNo = l.newNo ?? l.oldNo ?? 0;
                  const here = comments.filter((c) => c.file === file.path && c.line === lineNo);
                  const open = editing?.file === file.path && editing.line === lineNo;
                  return (
                    <div key={`${h.header}-${index}`}>
                      <div
                        className="group flex"
                        style={{ background: bg[l.kind] }}
                        data-testid="diff-line"
                      >
                        <button
                          aria-label={`Comment on line ${lineNo}`}
                          title="Comment on this line"
                          onClick={() => setEditing({ file: file.path, line: lineNo })}
                          className="w-14 shrink-0 border-0 bg-transparent px-1 text-right"
                          style={{ color: "var(--muted)" }}
                          data-testid="comment-line"
                        >
                          {l.newNo ?? l.oldNo ?? ""}
                        </button>
                        <span className="w-4 shrink-0 text-center">
                          {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                        </span>
                        <span className="whitespace-pre-wrap break-all">{l.text}</span>
                        {here.length > 0 && (
                          <MessageSquarePlus size={12} className="ml-2 mt-0.5 shrink-0" />
                        )}
                      </div>
                      {open && (
                        <div
                          className="flex gap-2 border-y px-2 py-1.5"
                          style={{ borderColor: "var(--line)", background: "var(--bg)" }}
                        >
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addComment()}
                            placeholder={`Comment on ${file.path}:${lineNo}`}
                            aria-label="Comment text"
                            data-testid="comment-text"
                            className="flex-1 rounded border px-2 py-1 font-sans"
                            style={{
                              borderColor: "var(--line)",
                              background: "var(--panel)",
                              color: "var(--text)",
                            }}
                          />
                          <Button variant="primary" onClick={addComment} data-testid="comment-save">
                            Add
                          </Button>
                          <Button onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {file?.truncated && (
              <EmptyState>This file is long; only its first 3000 lines are shown.</EmptyState>
            )}
          </div>
        </div>
      )}
      {comments.length > 0 && (
        <Panel
          title={`Comments (${comments.length})`}
          action={
            <Button variant="primary" onClick={() => void send()} data-testid="send-to-agent">
              <Send size={13} /> Send to agent
            </Button>
          }
        >
          <div data-testid="comment-list">
            {comments.map((c, i) => (
              <div
                key={`${c.file}-${c.line}-${i}`}
                className="flex items-center gap-2 py-0.5"
                data-testid="comment-item"
              >
                <code>
                  {c.file}:{c.line}
                </code>
                <span className="flex-1">{c.text}</span>
                <Button
                  variant="ghost"
                  aria-label="Remove comment"
                  onClick={() => setComments((all) => all.filter((_, j) => j !== i))}
                >
                  <X size={12} />
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
