import { Check, ExternalLink } from "lucide-react";
import type { PendingItem } from "@shared/models";
import { office } from "../lib/ipc";
import { useUi, type ViewId } from "../stores/ui";
import { Button, Group, StatusBadge, notifyError } from "../ui";
import { FixButton } from "./Fix";

const KIND_LABEL: Record<PendingItem["kind"], string> = {
  permission: "Approval",
  "agent-needs-you": "Agent",
  "agent-failed": "Agent failed",
  "task-gate": "Approval",
  "task-failed": "Task failed",
  conflict: "Conflict",
  "push-failed": "Not pushed",
  "ci-failed": "Checks failed",
  "review-requested": "Review",
  waiting: "For you",
  "save-proposal": "Brain",
};

/** The pending items that are something broken, which a session can fix (a question or a review is the owner's to answer). */
const FIXABLE: ReadonlySet<PendingItem["kind"]> = new Set([
  "agent-failed",
  "task-failed",
  "conflict",
  "push-failed",
  "ci-failed",
]);

/** Whether a session can fix this pending item. */
export const isFixable = (item: PendingItem): boolean => FIXABLE.has(item.kind);

/** The kind of a pending item, in words. */
export const kindName = (kind: PendingItem["kind"]): string => KIND_LABEL[kind];

/** Opens the place where a pending item is resolved. */
export function useOpenPending(): (item: PendingItem) => void {
  const navigate = useUi((s) => s.navigate);
  return (item) => navigate(item.link.view as ViewId, item.link.params ?? {});
}

/** Ignores an item until the state behind it changes. */
export async function dismissPending(item: PendingItem): Promise<void> {
  try {
    await office.invoke("pending.dismiss", { key: item.key, fingerprint: item.fingerprint });
  } catch (err) {
    notifyError(err, "Could not hide that item", "pending");
  }
}

/** Ticks off a line of "Waiting on you" in a project's notes. */
export async function tickWaiting(item: PendingItem): Promise<void> {
  if (!item.projectId || !item.waitingRaw) return;
  try {
    await office.invoke("vault.tickWaiting", { projectId: item.projectId, raw: item.waitingRaw });
  } catch (err) {
    notifyError(err, "Could not mark that done", "pending");
  }
}

/** One pending item: what it is, where it is resolved (Open) and how to ignore it (Dismiss). */
export function PendingRow({ item, compact = false }: { item: PendingItem; compact?: boolean }) {
  const open = useOpenPending();
  const answer = async (save: boolean): Promise<void> => {
    if (!item.proposalId) return;
    try {
      await office.invoke("recorder.answer", { id: item.proposalId, save });
    } catch (error) {
      notifyError(error, "Could not save the proposed note", "recorder");
    }
  };
  return (
    <div className="ui-line" data-testid="pending-item" data-kind={item.kind}>
      <StatusBadge
        status="info"
        tone={item.severity === "danger" ? "danger" : "attention"}
        label={kindName(item.kind)}
      />
      <div className="ui-line-main">
        <div>{item.title}</div>
        {item.detail && (!compact || item.proposalId) && <div className="ui-line-sub">{item.detail}</div>}
      </div>
      {isFixable(item) && <FixButton subject={{ type: "pending", key: item.key }} />}
      {item.proposalId ? (
        <Button size="sm" onClick={() => void answer(true)}>Save note</Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => open(item)} data-testid="pending-open">
          <ExternalLink /> Open
        </Button>
      )}
      {item.kind === "waiting" && (
        <Button size="sm" onClick={() => void tickWaiting(item)} data-testid="pending-done">
          <Check /> Done
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void (item.proposalId ? answer(false) : dismissPending(item))}
        data-testid="pending-dismiss"
      >
        Dismiss
      </Button>
    </div>
  );
}

/** The pending items grouped by project; items of no project come first. */
export function PendingGroups({ items, compact }: { items: PendingItem[]; compact?: boolean }) {
  const groups = new Map<string, PendingItem[]>();
  for (const i of items) {
    const name = i.kind === "waiting" ? (i.detail ?? "") : "";
    groups.set(name, [...(groups.get(name) ?? []), i]);
  }
  return (
    <>
      {[...groups].map(([name, list]) => (
        <section key={name}>
          {name && <Group>{name}</Group>}
          {list.map((i) => (
            <PendingRow key={i.key} item={i} {...(compact ? { compact } : {})} />
          ))}
        </section>
      ))}
    </>
  );
}
