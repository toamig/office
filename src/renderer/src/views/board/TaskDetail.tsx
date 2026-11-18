import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

const tone = (s: string): "neutral" | "good" | "warn" | "bad" =>
  s === "done" || s === "approved"
    ? "good"
    : s === "failed"
      ? "bad"
      : s === "waiting-gate" || s === "running"
        ? "warn"
        : "neutral";

function BuildDiff({ projectId, worktree }: { projectId: string; worktree: string }) {
  const branches = useQuery("branches.list", { projectId });
  const base = branches.data?.defaultBranch ?? "main";
  const diff = useQuery("diff.get", { projectId, dir: worktree, mode: "branch", base });
  const files = diff.data?.files ?? [];
  return (
    <div data-testid="task-diff">
      {diff.error && <ErrorBanner message={diff.error} />}
      {files.length === 0 && !diff.loading && (
        <EmptyState>No changes on this branch yet.</EmptyState>
      )}
      {files.map((f) => (
        <details key={f.path} className="mb-2" open>
          <summary className="cursor-pointer font-medium">
            {f.path}{" "}
            <span style={{ color: "var(--muted)" }}>
              +{f.additions} -{f.deletions}
            </span>
          </summary>
          <div className="font-mono text-[12.5px]">
            {f.hunks.flatMap((h) =>
              h.lines.map((l, i) => (
                <div
                  key={`${h.header}-${i}`}
                  style={{
                    background:
                      l.kind === "add"
                        ? "rgba(46,158,91,0.16)"
                        : l.kind === "del"
                          ? "rgba(207,74,74,0.16)"
                          : "transparent",
                  }}
                  className="whitespace-pre-wrap break-all px-2"
                >
                  {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} {l.text}
                </div>
              )),
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** One task: each stage's output as markdown, the diff for build stages, and Approve, Reject, Cancel and Retry. */
export function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const task = useQuery("tasks.get", { id }, ["task.changed"]);
  const [stage, setStage] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = task.data;
  const run = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await work();
      task.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (!t)
    return (
      <Panel title="Task">
        {task.error ? <ErrorBanner message={task.error} /> : <EmptyState>Loading...</EmptyState>}
      </Panel>
    );

  const shown =
    t.stages.find((s) => s.stageId === stage) ??
    t.stages[Math.min(t.stageIndex, t.stages.length - 1)];
  const waiting = t.status === "waiting-gate";
  return (
    <Panel
      title={t.title}
      action={
        <Button variant="ghost" aria-label="Close task" onClick={onClose}>
          <X size={14} />
        </Button>
      }
    >
      <div data-testid="task-detail">
        {error && <ErrorBanner message={error} />}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Chip>{t.projectName}</Chip>
          <Chip>{t.pipelineName}</Chip>
          <Chip tone={tone(t.status)}>{t.status}</Chip>
          {t.branch && <Chip>{t.branch}</Chip>}
        </div>
        <p className="mt-0" style={{ color: "var(--muted)" }}>
          {t.description}
        </p>
        <div className="mb-3 flex flex-wrap gap-1">
          {t.stages.map((s) => (
            <button
              key={s.stageId}
              data-testid="stage-tab"
              data-status={s.status}
              onClick={() => setStage(s.stageId)}
              className="cursor-pointer rounded border px-2 py-1"
              style={{
                borderColor: shown?.stageId === s.stageId ? "var(--accent)" : "var(--line)",
                background: "transparent",
                color: "var(--text)",
              }}
            >
              {s.stageId} <Chip tone={tone(s.status)}>{s.status}</Chip>
            </button>
          ))}
        </div>
        {shown && (
          <div className="mb-3">
            <div className="mb-1 text-[12px]" style={{ color: "var(--muted)" }}>
              {shown.role} on {shown.provider ?? "an unknown provider"}
            </div>
            {shown.error && <ErrorBanner message={shown.error} />}
            {t.outputs[shown.stageId] ? (
              <div data-testid="stage-output">
                <Markdown>{t.outputs[shown.stageId] as string}</Markdown>
              </div>
            ) : (
              <EmptyState>No output yet.</EmptyState>
            )}
            {shown.worktree && t.worktree && (
              <BuildDiff projectId={t.projectId} worktree={t.worktree} />
            )}
            {!shown.worktree &&
              t.worktree &&
              shown.stageId !== t.stages[0]?.stageId &&
              shown.stageId === t.stages[t.stages.length - 1]?.stageId && (
                <BuildDiff projectId={t.projectId} worktree={t.worktree} />
              )}
          </div>
        )}
        {waiting && (
          <div className="grid gap-2">
            {rejecting && (
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="What should change? The stage runs again with this added."
                aria-label="Rejection comment"
                data-testid="reject-comment"
                className="rounded border px-2 py-1"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => void run(() => office.invoke("tasks.approve", { id }))}
                data-testid="task-approve"
              >
                <Check size={13} /> Approve
              </Button>
              {!rejecting ? (
                <Button onClick={() => setRejecting(true)} data-testid="task-reject-open">
                  Reject
                </Button>
              ) : (
                <Button
                  disabled={!comment.trim()}
                  onClick={() =>
                    void run(async () => {
                      await office.invoke("tasks.reject", { id, comment });
                      setRejecting(false);
                      setComment("");
                    })
                  }
                  data-testid="task-reject"
                >
                  Send back with this comment
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="mt-3 flex gap-2">
          {t.status === "failed" && (
            <Button
              onClick={() => void run(() => office.invoke("tasks.retry", { id }))}
              data-testid="task-retry"
            >
              <RotateCcw size={13} /> Retry this stage
            </Button>
          )}
          {(t.status === "running" || waiting || t.status === "failed") && (
            <Button
              onClick={() => void run(() => office.invoke("tasks.cancel", { id }))}
              data-testid="task-cancel"
            >
              Cancel task
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
