import type { PendingItem } from "@shared/models";
import { useQuery } from "./query";

export interface Pending {
  items: PendingItem[];
  /** The colour of the most serious item, or null with none. */
  worst: "danger" | "attention" | null;
  reload: () => void;
}

/** What waits on the owner right now: one list for the bell, Home and the Needs you view. */
export function usePending(): Pending {
  const q = useQuery("pending.list", undefined, ["pending.changed"]);
  const items = q.data ?? [];
  const worst = items.some((i) => i.severity === "danger")
    ? "danger"
    : items.length > 0
      ? "attention"
      : null;
  return { items, worst, reload: q.reload };
}
