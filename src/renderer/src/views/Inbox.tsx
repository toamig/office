import { useState } from "react";
import { VirtualList } from "../components/VirtualList";
import type { PendingItem } from "@shared/models";
import { InspectorSlot } from "../components/Inspector";
import { PendingRow, kindName, useOpenPending } from "../components/PendingList";
import { PermissionRequests } from "../components/PermissionRequests";
import { usePending } from "../lib/pending";
import { Button, Dropdown, EmptyState, Page, StatusBadge } from "../ui";
import { useQuery } from "../lib/hooks";

function Detail({ item, onOpen }: { item: PendingItem | null; onOpen: () => void }) {
  if (!item)
    return (
      <div className="ui-surface h-full p-4" data-testid="inbox-detail">
        <EmptyState title="Pick an item">
          Its details and where to deal with it show here.
        </EmptyState>
      </div>
    );
  return (
    <article className="ui-surface grid h-full content-start gap-3 p-4" data-testid="inbox-detail">
      <h2 className="m-0 text-[length:var(--text-lg)]">{item.title}</h2>
      <div className="ui-badges">
        <StatusBadge
          status="info"
          tone={item.severity === "danger" ? "danger" : "attention"}
          label={kindName(item.kind)}
        />
      </div>
      {item.detail && <p className="reading m-0">{item.detail}</p>}
      <div>
        <Button variant="primary" onClick={onOpen} data-testid="inbox-open">
          Open
        </Button>
      </div>
    </article>
  );
}

/** Everything that waits on you, until you have dealt with it: the same list as the bell and Home. */
export function Inbox() {
  const { items } = usePending();
  const open = useOpenPending();
  const projects = useQuery("projects.list");
  const [projectId, setProjectId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const rows = items.filter(
    // An open permission question is drawn as its card above, with Allow and Deny.
    (i) => i.kind !== "permission" && (projectId === "" || i.projectId === projectId),
  );
  const current = rows.find((i) => i.key === selected) ?? null;
  return (
    <Page
      title="Needs you"
      subtitle="What is waiting on you, until you have dealt with it."
      testId="inbox"
      fill
    >
      <div className="flex flex-wrap items-center gap-4">
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
      {rows.length === 0 && items.every((i) => i.kind !== "permission") && (
        <EmptyState title="Nothing needs you">
          Approvals, agents that need you, conflicts, failed checks and review requests show up here
          until you have dealt with them.
        </EmptyState>
      )}
      <div className="ui-surface min-h-0 flex-1 overflow-auto" data-testid="inbox-list">
        <VirtualList
          items={rows}
          estimate={64}
          itemKey={(i) => i.key}
          renderItem={(i) => (
            <div
              data-selected={i.key === selected ? "true" : undefined}
              onClick={() => setSelected(i.key)}
            >
              <PendingRow item={i} />
            </div>
          )}
        />
      </div>
      <InspectorSlot view="inbox">
        <Detail item={current} onOpen={() => current && open(current)} />
      </InspectorSlot>
    </Page>
  );
}
