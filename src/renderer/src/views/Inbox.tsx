import { Check } from "lucide-react";
import { useState } from "react";
import type { NotificationRow } from "@shared/models";
import { InspectorSlot } from "../components/Inspector";
import { PermissionRequests } from "../components/PermissionRequests";
import { VirtualList } from "../components/VirtualList";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { useUi, type ViewId } from "../stores/ui";
import { Banner, Button, Dropdown, EmptyState, Page, StatusBadge, Time, notifyError } from "../ui";

/** A notification kind in words: "git.conflict" reads "Git conflict". */
export function kindLabel(kind: string): string {
  const words = kind.replace(/[._-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Detail({ note, onOpen }: { note: NotificationRow | null; onOpen: () => void }) {
  if (!note)
    return (
      <div className="ui-surface h-full p-4" data-testid="inbox-detail">
        <EmptyState title="Pick a notification">
          Its details and the place it points to show here.
        </EmptyState>
      </div>
    );
  return (
    <article className="ui-surface grid h-full content-start gap-3 p-4" data-testid="inbox-detail">
      <h2 className="m-0 text-[length:var(--text-lg)]">{note.title}</h2>
      <div className="ui-badges">
        {note.urgent && <StatusBadge status="failed" label="Urgent" />}
        <span className="ui-muted">{kindLabel(note.kind)}</span>
        <Time iso={note.createdAt} />
      </div>
      {note.body && <p className="reading m-0">{note.body}</p>}
      {note.link && (
        <div>
          <Button variant="primary" onClick={onOpen} data-testid="inbox-open">
            Open
          </Button>
        </div>
      )}
    </article>
  );
}

/** Every notification in one place, with filters for unread, urgent and project. */
export function Inbox() {
  const navigate = useUi((s) => s.navigate);
  const [unread, setUnread] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // A long history is drawn in windows (past about 200 rows), so it can be asked for in full.
  const filter = {
    limit: 1000,
    ...(unread ? { unread: true } : {}),
    ...(urgent ? { urgent: true } : {}),
    ...(projectId ? { projectId } : {}),
  };
  const list = useQuery("notifications.list", filter, ["notification.new", "notification.read"]);
  const projects = useQuery("projects.list");
  const rows = (list.data ?? []).filter(
    // An open permission question is drawn as its card above, so its row waits until it is answered.
    (n) => !(n.kind === "permission.request" && n.readAt === null),
  );
  const current = rows.find((n) => n.id === selected) ?? null;

  const pick = (n: NotificationRow): void => {
    setSelected(n.id);
    if (n.readAt === null)
      void office
        .invoke("notifications.markRead", { ids: [n.id] })
        .then(list.reload, (err: unknown) => notifyError(err, "Could not mark that read", "inbox"));
  };
  const open = (n: NotificationRow): void => {
    if (n.link) navigate(n.link.view as ViewId, n.link.params ?? {});
  };

  return (
    <Page
      title="Inbox"
      testId="inbox"
      fill
      primary={
        <Button
          onClick={() =>
            void office
              .invoke("notifications.markRead", {})
              .then(list.reload, (err: unknown) =>
                notifyError(err, "Could not mark all read", "inbox"),
              )
          }
          data-testid="mark-all-read"
        >
          <Check /> Mark all read
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />{" "}
          Unread only
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />{" "}
          Urgent only
        </label>
        <Dropdown
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Project"
        >
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Dropdown>
      </div>
      <PermissionRequests />
      {list.error && <Banner tone="danger">{list.error}</Banner>}
      {list.data?.length === 0 && (
        <EmptyState title="Nothing here yet">
          Sync conflicts, agents that need you and new items for you will show up.
        </EmptyState>
      )}
      <div className="ui-surface min-h-0 flex-1 overflow-auto" data-testid="inbox-list">
        <VirtualList
          items={rows}
          estimate={64}
          itemKey={(n) => n.id}
          renderItem={(n) => (
            <div
              data-testid="notification"
              className="ui-row"
              role="button"
              tabIndex={0}
              data-clickable="true"
              data-selected={n.id === selected ? "true" : undefined}
              style={{ opacity: n.readAt ? 0.65 : 1 }}
              onClick={() => pick(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter") pick(n);
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{n.title}</div>
                {n.body && <div className="ui-line-sub truncate">{n.body}</div>}
              </div>
              {n.urgent && <StatusBadge status="failed" label="Urgent" />}
              <span className="ui-line-sub">
                <Time iso={n.createdAt} />
              </span>
            </div>
          )}
        />
      </div>
      <InspectorSlot view="inbox">
        <Detail note={current} onOpen={() => current && open(current)} />
      </InspectorSlot>
    </Page>
  );
}
