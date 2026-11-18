import { ExternalLink } from "lucide-react";
import type { NotificationRow, TaskView } from "@shared/models";
import { Button } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { useUi } from "../../stores/ui";

const rowClass = "flex items-start gap-2 border-b py-1.5";
const lineStyle = { borderColor: "var(--line)" };

/** Unread notifications of the given kinds, for the Home panels that watch them. */
export function useUnreadOfKind(kinds: string[]): { rows: NotificationRow[]; reload: () => void } {
  const all = useQuery("notifications.list", { unread: true, limit: 200 }, [
    "notification.new",
    "notification.read",
  ]);
  return { rows: (all.data ?? []).filter((n) => kinds.includes(n.kind)), reload: all.reload };
}

/** Task gates waiting for an approval, and pull requests waiting for a review: the rest of "Waiting on you". */
export function GatesAndReviews() {
  const navigate = useUi((s) => s.navigate);
  const tasks = useQuery("tasks.list", {}, ["task.changed"]);
  const reviews = useUnreadOfKind(["pr.review-requested"]);
  const gates = (tasks.data ?? []).filter((t: TaskView) => t.status === "waiting-gate");
  return (
    <>
      {gates.map((t) => {
        const stage = t.stages[t.stageIndex];
        return (
          <div key={t.id} className={rowClass} style={lineStyle} data-testid="waiting-gate">
            <div className="flex-1">
              <div>
                Approve {stage?.stageId ?? "the stage"} of &quot;{t.title}&quot;
              </div>
              <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                {t.projectName}, {t.pipelineName}
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={() => navigate("board", { task: t.id })}
              data-testid="open-waiting-gate"
            >
              <ExternalLink size={13} /> Open
            </Button>
          </div>
        );
      })}
      {reviews.rows.map((n) => (
        <div key={n.id} className={rowClass} style={lineStyle} data-testid="waiting-review">
          <div className="flex-1">
            <div>{n.title}</div>
            {n.body && (
              <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                {n.body}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={() => void office.invoke("notifications.markRead", { ids: [n.id] })}
            data-testid="dismiss-waiting-review"
          >
            Dismiss
          </Button>
        </div>
      ))}
    </>
  );
}
