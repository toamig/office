import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Button, Card, EmptyState, IconButton, StatusBadge, Textarea, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

function BuildDiff({
  projectId,
  worktree,
  baseBranch,
}: {
  projectId: string;
  worktree: string;
  baseBranch?: string;
}) {
  const branches = useQuery("branches.list", { projectId });
  const base = baseBranch ?? branches.data?.defaultBranch ?? "main";
  const diff = useQuery("diff.get", { projectId, dir: worktree, mode: "branch", base });
  const files = diff.data?.files ?? [];
  return (
    <div data-testid="task-diff">
      {diff.error && <p className="ui-bad">{diff.error}</p>}
      {files.length === 0 && !diff.loading && (
        <EmptyState title="No changes yet">Nothing has changed on this branch.</EmptyState>
      )}
      {files.map((f) => (
        <details key={f.path} className="mb-2" open>
          <summary className="font-medium">
            {f.path}{" "}
            <span className="ui-muted">
              +{f.additions} -{f.deletions}
            </span>
          </summary>
          <div className="font-mono text-[length:var(--text-sm)]">
            {f.hunks.flatMap((h) =>
              h.lines.map((l, i) => (
                <div
                  key={`${h.header}-${i}`}
                  style={{
                    background:
                      l.kind === "add"
                        ? "color-mix(in srgb, var(--success-fg) 16%, transparent)"
                        : l.kind === "del"
                          ? "color-mix(in srgb, var(--danger-fg) 16%, transparent)"
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
  const [confirmKeep, setConfirmKeep] = useState<number | null>(null);

  const t = task.data;
  const run = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
      task.reload();
    } catch (err) {
      notifyError(err, "That did not work", `task-${id}`);
    }
  };
  if (!t)
    return (
      <Card title="Task">
        {task.error ? (
          <p className="ui-bad">{task.error}</p>
        ) : (
          <p className="ui-muted">Loading...</p>
        )}
      </Card>
    );

  const shown =
    t.stages.find((s) => s.stageId === stage) ??
    t.stages[Math.min(t.stageIndex, t.stages.length - 1)];
  const waiting = t.status === "waiting-gate";
  return (
    <Card
      title={t.title}
      action={
        <IconButton label="Close task" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      }
    >
      <div data-testid="task-detail">
        <div className="ui-badges mb-2">
          <StatusBadge status={t.status} />
          <span>{t.projectName}</span>
          <span className="ui-muted">{t.pipelineName}</span>
          {t.branch && <code className="ui-path">{t.branch}</code>}
        </div>
        <p className="mt-0 ui-muted">{t.description}</p>
        <div className="mb-3 flex flex-wrap gap-1">
          {t.stages.map((s) => (
            <Button
              key={s.stageId}
              size="sm"
              data-testid="stage-tab"
              data-status={s.status}
              aria-pressed={shown?.stageId === s.stageId}
              variant={shown?.stageId === s.stageId ? "secondary" : "ghost"}
              onClick={() => setStage(s.stageId)}
            >
              {s.stageId} <StatusBadge status={s.status} />
            </Button>
          ))}
        </div>
        {shown && (
          <div className="mb-3">
            <div className="mb-1 text-[length:var(--text-xs)] ui-muted">
              {shown.role} on {shown.provider ?? "an unknown provider"}
            </div>
            {shown.error && <p className="ui-bad">{shown.error}</p>}
            {t.outputs[shown.stageId] ? (
              <div data-testid="stage-output">
                <Markdown>{t.outputs[shown.stageId] as string}</Markdown>
              </div>
            ) : (
              <p className="ui-muted">No output yet.</p>
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
        {t.variants.length > 0 && (
          <div className="mb-3" data-testid="compare">
            <div className="mb-1 font-semibold">Builders, side by side</div>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${Math.min(t.variants.length, 2)}, minmax(0, 1fr))`,
              }}
            >
              {t.variants.map((v) => (
                <div
                  key={v.n}
                  className="ui-surface p-3"
                  data-testid="variant"
                  data-status={v.status}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="font-medium">Builder {v.n}</span>
                    <StatusBadge status={v.status} />
                  </div>
                  <div
                    className="mb-1 text-[length:var(--text-xs)] ui-muted"
                    data-testid="variant-checks"
                  >
                    {v.status === "failed"
                      ? (v.error ?? "failed")
                      : `${v.commits} commit(s), ${v.files.length} file(s), +${v.additions} -${v.deletions}`}
                  </div>
                  {v.status === "done" && t.branch && (
                    <BuildDiff
                      projectId={t.projectId}
                      worktree={v.worktree}
                      baseBranch={t.branch}
                    />
                  )}
                  {waiting &&
                    v.status === "done" &&
                    (confirmKeep === v.n ? (
                      <div className="mt-2" data-testid="keep-confirm">
                        <div className="ui-warn mb-1">
                          This merges {v.branch} into the task branch and removes the other
                          builders' worktrees. Continue?
                        </div>
                        <Button
                          variant="primary"
                          onClick={() =>
                            void run(async () => {
                              await office.invoke("tasks.keep", { id, variant: v.n });
                              setConfirmKeep(null);
                            })
                          }
                          data-testid="keep-yes"
                        >
                          Yes, keep builder {v.n}
                        </Button>
                        <Button onClick={() => setConfirmKeep(null)}>No</Button>
                      </div>
                    ) : (
                      <Button onClick={() => setConfirmKeep(v.n)} data-testid="keep-variant">
                        Keep this one
                      </Button>
                    ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {waiting && (
          <div className="grid gap-2">
            {rejecting && (
              <Textarea
                label="Rejection comment"
                hideLabel
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="What should change? The stage runs again with this added."
                data-testid="reject-comment"
              />
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => void run(() => office.invoke("tasks.approve", { id }))}
                data-testid="task-approve"
              >
                <Check /> Approve
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
        {t.status === "done" && (
          <div className="mt-3">
            {t.recorded ? (
              <StatusBadge status="saved" label="Recorded in the project notes" />
            ) : (
              <Button
                onClick={() => void run(() => office.invoke("tasks.record", { id }))}
                data-testid="task-record"
              >
                Record it in the project notes
              </Button>
            )}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          {t.status === "failed" && (
            <Button
              onClick={() => void run(() => office.invoke("tasks.retry", { id }))}
              data-testid="task-retry"
            >
              <RotateCcw /> Retry this stage
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
    </Card>
  );
}
