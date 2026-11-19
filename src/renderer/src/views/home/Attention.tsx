import { ExternalLink } from "lucide-react";
import type { NotificationRow, TaskView } from "@shared/models";
import { PermissionRequests } from "../../components/PermissionRequests";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { Button } from "../../ui";

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
      <PermissionRequests compact />
      {gates.map((t) => {
        const stage = t.stages[t.stageIndex];
        return (
          <div key={t.id} className="ui-line" data-testid="waiting-gate">
            <div className="ui-line-main">
              <div>
                Approve {stage?.stageId ?? "the stage"} of &quot;{t.title}&quot;
              </div>
              <div className="ui-line-sub">
                {t.projectName}, {t.pipelineName}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("board", { task: t.id })}
              data-testid="open-waiting-gate"
            >
              <ExternalLink /> Open
            </Button>
          </div>
        );
      })}
      {reviews.rows.map((n) => (
        <div key={n.id} className="ui-line" data-testid="waiting-review">
          <div className="ui-line-main">
            <div>{n.title}</div>
            {n.body && <div className="ui-line-sub">{n.body}</div>}
          </div>
          <Button
            variant="ghost"
            size="sm"
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
