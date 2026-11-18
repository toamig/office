import { useState } from "react";
import { Button, Chip, ErrorBanner } from "./ui";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";

/**
 * Questions from headless builders ("may I run this?"), each with Allow and Deny. Allow is for this one
 * request; to allow a command for good, add it to the role's allowed commands.
 */
export function PermissionRequests({ compact = false }: { compact?: boolean }) {
  const requests = useQuery("permissions.list", undefined, [
    "permission.changed",
    "notification.new",
  ]);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const answer = async (id: string, allow: boolean): Promise<void> => {
    setError(null);
    try {
      await office.invoke("permissions.answer", {
        id,
        allow,
        ...(reasons[id]?.trim() ? { reason: reasons[id] } : {}),
      });
      requests.reload();
    } catch (err) {
      setError((err as Error).message);
      requests.reload();
    }
  };
  const list = requests.data ?? [];
  if (list.length === 0 && !error) return null;
  return (
    <div data-testid="permission-requests" className={compact ? "" : "mb-4"}>
      {error && <ErrorBanner message={error} />}
      {list.map((r) => (
        <div
          key={r.id}
          data-testid="permission-request"
          className="mb-1.5 rounded border px-3 py-2"
          style={{ borderColor: "#c98a12", background: "var(--panel)" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="warn">waiting for you</Chip>
            <span className="font-medium">{r.subject}</span>
            <span style={{ color: "var(--muted)" }}>wants to run</span>
          </div>
          <div className="my-1 break-all font-mono text-[12.5px]" data-testid="permission-summary">
            {r.summary}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <input
              className="min-w-[200px] flex-1 rounded border px-2 py-1"
              style={{
                borderColor: "var(--line)",
                background: "var(--bg)",
                color: "var(--text)",
              }}
              placeholder="Reason for denying (sent to the agent)"
              value={reasons[r.id] ?? ""}
              onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
              aria-label="Reason for denying"
              data-testid="permission-reason"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
