import { Check } from "lucide-react";
import { useState } from "react";
import { PermissionRequests } from "../components/PermissionRequests";
import { Button, Chip, EmptyState, ErrorBanner } from "../components/ui";
import { office } from "../lib/ipc";
import { timeAgo, useQuery } from "../lib/hooks";
import { useUi, type ViewId } from "../stores/ui";

/** Every notification in one place, with filters for unread, urgent and project. */
export function Inbox() {
  const navigate = useUi((s) => s.navigate);
  const [unread, setUnread] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [projectId, setProjectId] = useState("");
  const filter = {
    ...(unread ? { unread: true } : {}),
    ...(urgent ? { urgent: true } : {}),
    ...(projectId ? { projectId } : {}),
  };
  const list = useQuery("notifications.list", filter, ["notification.new", "notification.read"]);
  const projects = useQuery("projects.list");

  const open = async (
    id: string,
    link: { view: string; params?: Record<string, string> } | null,
  ) => {
    await office.invoke("notifications.markRead", { ids: [id] });
    list.reload();
    if (link) navigate(link.view as ViewId, link.params ?? {});
  };

  return (
    <div className="mx-auto max-w-3xl p-6" data-testid="inbox">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Inbox</h1>
        <div className="flex-1" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />{" "}
          Unread
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />{" "}
          Urgent
        </label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Project"
          className="rounded border px-1 py-0.5"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--text)" }}
        >
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          onClick={() => void office.invoke("notifications.markRead", {}).then(list.reload)}
          data-testid="mark-all-read"
        >
          <Check size={14} /> Mark all read
        </Button>
      </div>
      <PermissionRequests />
      {list.error && <ErrorBanner message={list.error} />}
      {list.data?.length === 0 && (
        <EmptyState>
          Nothing here. Sync conflicts, agents that need you and new items for you will show up.
        </EmptyState>
      )}
      <ul className="m-0 list-none p-0">
        {/* An open permission question is drawn as its card above, so its row waits until it is answered. */}
        {list.data
          ?.filter((n) => !(n.kind === "permission.request" && n.readAt === null))
          .map((n) => (
            <li
              key={n.id}
              data-testid="notification"
              className="mb-1.5 flex items-start gap-3 rounded border px-3 py-2"
              style={{
                borderColor: "var(--line)",
                background: "var(--panel)",
                opacity: n.readAt ? 0.6 : 1,
              }}
              onClick={() => void open(n.id, n.link)}
            >
              <div className="flex-1">
                <div className="font-medium">{n.title}</div>
                {n.body && (
                  <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                    {n.body}
                  </div>
                )}
              </div>
              {n.urgent && <Chip tone="bad">urgent</Chip>}
              <Chip>{n.kind}</Chip>
              <span className="w-20 text-right text-[12px]" style={{ color: "var(--muted)" }}>
                {timeAgo(n.createdAt)}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
