import { useState } from "react";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Button, Input, StatusBadge, notifyError } from "../ui";

/**
 * Questions from headless builders ("may I run this?"), each with Allow and Deny. Allow is for this one
 * request; to allow a command for good, add it to the role's allowed commands.
 */
export function PermissionRequests({
  compact = false,
  runId,
}: {
  compact?: boolean;
  /** Only the questions of this run or chat (an inline card in a conversation). */
  runId?: string;
}) {
  const requests = useQuery("permissions.list", undefined, ["permission.changed"]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const answer = async (id: string, allow: boolean): Promise<void> => {
    try {
      await office.invoke("permissions.answer", {
        id,
        allow,
        ...(reasons[id]?.trim() ? { reason: reasons[id] } : {}),
      });
    } catch (err) {
      notifyError(err, "Could not answer that request", `permission-${id}`);
    }
    requests.reload();
  };
  const list = (requests.data ?? []).filter((r) => !runId || r.runId === runId);
  if (list.length === 0) return null;
  return (
    <div data-testid="permission-requests" className={compact ? "" : "mb-4"}>
      {list.map((r) => (
        <div key={r.id} data-testid="permission-request" className="ui-ask">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="waiting-permission" />
            <span className="font-medium">{r.subject}</span>
            <span className="ui-muted">wants to run</span>
          </div>
          <div className="ui-code" data-testid="permission-summary">
            {r.summary}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button
              variant="primary"
              onClick={() => void answer(r.id, true)}
              data-testid="permission-allow"
            >
              Allow once
            </Button>
            <Button onClick={() => void answer(r.id, false)} data-testid="permission-deny">
              Deny
            </Button>
            <Input
              className="min-w-[200px] flex-1"
              label="Reason for denying"
              hideLabel
              placeholder="Reason for denying (sent to the agent)"
              value={reasons[r.id] ?? ""}
              onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
              data-testid="permission-reason"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
