import type { SyncRepoResult } from "@shared/models";
import { useUi } from "../stores/ui";
import { Button, Dialog, EmptyState, Group, StatusBadge } from "../ui";

/** The per-repo result of Sync all: pulled, pushed, conflict, skipped and why. */
export function SyncReportDialog() {
  const report = useUi((s) => s.syncReport);
  const close = useUi((s) => s.setSyncReport);
  if (!report) return null;
  // The brain's own repos are reported by the hub tool, under ids that start with hub:.
  const projects = report.repos.filter((r) => !r.id.startsWith("hub:"));
  const notes = report.repos.filter((r) => r.id.startsWith("hub:"));
  return (
    <Dialog
      title={`Sync all: ${report.repos.length} ${report.repos.length === 1 ? "repo" : "repos"}`}
      testId="sync-report"
      wide
      onClose={() => close(null)}
      footer={<Button onClick={() => close(null)}>Close</Button>}
    >
      {report.repos.length === 0 && (
        <EmptyState title="Nothing to sync">Add projects first, from the Projects page.</EmptyState>
      )}
      {[
        ["Projects", projects],
        ["Brain notes", notes],
      ].map(([title, rows]) =>
        (rows as SyncRepoResult[]).length === 0 ? null : (
          <section
            key={title as string}
            data-testid={`sync-group-${(title as string).toLowerCase().replace(" ", "-")}`}
          >
            <Group>{title as string}</Group>
            <ul className="m-0 list-none p-0">
              {(rows as SyncRepoResult[]).map((r) => (
                <li key={r.id} className="ui-line" data-testid="sync-row">
                  <span className="w-44 shrink-0 font-medium">{r.name}</span>
                  <StatusBadge status={r.action} />
                  <span className="ui-muted ui-line-main">{r.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </Dialog>
  );
}
