import { MessageSquarePlus, Send, X } from "lucide-react";
import { useState } from "react";
import type { DiffFile, ReviewComment } from "@shared/models";
import { Button, Card, EmptyState, IconButton, notifyDone, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Dropdown as Select } from "../../ui";
import { InspectorSlot } from "../../components/Inspector";
import { VirtualList } from "../../components/VirtualList";

type Mode = "working" | "staged" | "branch";

type DiffHunk = DiffFile["hunks"][number];
type DiffRow =
  | { kind: "header"; key: string; header: string }
  | { kind: "line"; key: string; h: DiffHunk; l: DiffHunk["lines"][number]; index: number };

/** A file's hunks as one flat list of rows (a header, then its lines), so a long diff can be drawn in windows. */
function diffRows(file: DiffFile): DiffRow[] {
  const rows: DiffRow[] = [];
  file.hunks.forEach((h, hi) => {
    rows.push({ kind: "header", key: `h${hi}`, header: h.header });
    h.lines.forEach((l, index) => rows.push({ kind: "line", key: `h${hi}-${index}`, h, l, index }));
  });
  return rows;
}

/** Changed files and a unified diff with line comments that can go back to the agent that made the change. */
export function DiffTab({ projectId, workingDir = "", inspect = true }: { projectId: string; workingDir?: string; inspect?: boolean }) {
  const worktrees = useQuery("worktrees.list", { projectId }, ["project.status"]);
  const branches = useQuery("branches.list", { projectId });
  const [dir, setDir] = useState(workingDir);
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

  const files = diff.data?.files ?? [];
  const file: DiffFile | undefined = files.find((f) => f.path === selected) ?? files[0];

  const addComment = (): void => {
    if (!editing || !draft.trim()) return;
    setComments((all) => [...all, { file: editing.file, line: editing.line, text: draft.trim() }]);
    setEditing(null);
    setDraft("");
  };
  const send = async (): Promise<void> => {
    try {
      const result = await office.invoke("diff.sendComments", {
        projectId,
        ...(dir ? { dir } : {}),
        comments,
      });
      notifyDone(
        result.started ? "Started a builder session" : "Comments sent",
        result.started ? "It has your comments." : "The running agent has your comments.",
        "review",
      );
      setComments([]);
    } catch (err) {
      notifyError(err, "Could not send the comments", "review");
    }
  };

  return (
    <div className="grid gap-3" data-testid="diff-tab">
      {inspect && <InspectorSlot view="git">
        {file && (
          <Card title="Selected file" testId="git-file-inspector">
            <dl className="ui-dl">
              <dt>Path</dt>
              <dd className="break-all">{file.path}</dd>
              <dt>State</dt>
              <dd>{file.status}</dd>
              <dt>Lines</dt>
              <dd className="num">
                {file.binary ? "Binary" : `+${file.additions} -${file.deletions}`}
              </dd>
            </dl>
            <div className="mt-3">
              <Button size="sm" onClick={() => void navigator.clipboard.writeText(file.path)}>
                Copy path
              </Button>
            </div>
          </Card>
        )}
      </InspectorSlot>}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          aria-label="Checkout"
          data-testid="diff-dir"
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
          <Select
            value={baseName}
            onChange={(e) => setBase(e.target.value)}
            aria-label="Base branch"
          >
            {(branches.data?.local ?? []).map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {diff.error && <p className="ui-bad">{diff.error}</p>}
      {files.length === 0 && !diff.loading && (
        <EmptyState title="No changes to review">There is nothing different here.</EmptyState>
      )}
      {files.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
          <div className="ui-surface" data-testid="diff-files">
            <VirtualList
              items={files}
              estimate={50}
              itemKey={(f) => f.path}
              renderItem={(f) => (
                <div
                  data-testid="diff-file"
                  onClick={() => setSelected(f.path)}
                  className="ui-row"
                  data-clickable="true"
                  data-selected={file?.path === f.path ? "true" : undefined}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{f.path}</div>
                    <div className="text-[length:var(--text-xs)] ui-muted">
                      {f.status}
                      {f.binary ? ", binary" : ` +${f.additions} -${f.deletions}`}
                    </div>
                  </div>
                </div>
              )}
            />
          </div>
          <div className="ui-surface min-w-0" data-testid="diff-view">
            {file?.binary && <EmptyState title="Binary file">There is no text to show.</EmptyState>}
            {file && (
              <VirtualList
                items={diffRows(file)}
                estimate={20}
                itemKey={(row) => row.key}
                renderItem={(row) => {
                  if (row.kind === "header") {
                    return <div className="diff-hunk">{row.header}</div>;
                  }
                  const { h, l, index } = row;
                  const lineNo = l.newNo ?? l.oldNo ?? 0;
                  const here = comments.filter((c) => c.file === file.path && c.line === lineNo);
                  const open = editing?.file === file.path && editing.line === lineNo;
                  return (
                    <div
                      key={`${h.header}-${index}`}
                      className="font-mono text-[length:var(--text-sm)]"
                    >
                      <div className={`group flex diff-${l.kind}`} data-testid="diff-line">
                        <button
                          aria-label={`Comment on line ${lineNo}`}
                          title="Comment on this line"
                          onClick={() => setEditing({ file: file.path, line: lineNo })}
                          className="w-14 shrink-0 border-0 bg-transparent px-1 text-right ui-muted"
                          data-testid="comment-line"
                        >
                          {l.newNo ?? l.oldNo ?? ""}
                        </button>
                        <span className="w-4 shrink-0 text-center">
                          {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                        </span>
                        <span className="whitespace-pre-wrap break-all">{l.text}</span>
                        {here.length > 0 && (
                          <MessageSquarePlus size={14} className="ml-2 mt-0.5 shrink-0" />
                        )}
                      </div>
                      {open && (
                        <div className="diff-comment">
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addComment()}
                            placeholder={`Comment on ${file.path}:${lineNo}`}
                            aria-label="Comment text"
                            data-testid="comment-text"
                            className="flex-1 font-sans"
                          />
                          <Button variant="primary" onClick={addComment} data-testid="comment-save">
                            Add
                          </Button>
                          <Button onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            )}
            {file?.truncated && (
              <p className="ui-muted p-3">
                This file is long; only its first 3000 lines are shown.
              </p>
            )}
          </div>
        </div>
      )}
      {comments.length > 0 && (
        <Card
          title={`Comments (${comments.length})`}
          action={
            <Button variant="primary" onClick={() => void send()} data-testid="send-to-agent">
              <Send /> Send to agent
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
                <IconButton
                  size="sm"
                  label="Remove comment"
                  onClick={() => setComments((all) => all.filter((_, j) => j !== i))}
                >
                  <X />
                </IconButton>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
