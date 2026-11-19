import type { SessionStatus } from "@shared/models";
import { StatusBadge } from "../ui";

/** The status of a session as the one badge every status uses. */
export function StatusChip({ status }: { status: SessionStatus }) {
  return <StatusBadge status={status} />;
}
