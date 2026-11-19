import { X } from "lucide-react";
import type { SyncAction, SyncRepoResult } from "@shared/models";
import { useUi } from "../stores/ui";
import { Button, Chip, EmptyState } from "./ui";
import { useEscape } from "../lib/escape";

const label: Record<SyncAction, string> = {
  pulled: "Pulled",
  pushed: "Pushed",
  "pulled-and-pushed": "Pulled and pushed",
  "up-to-date": "Up to date",
  conflict: "Conflict",
  skipped: "Skipped",
  failed: "Failed",
};

const tone = (a: SyncAction): "neutral" | "good" | "warn" | "bad" =>
  a === "conflict" || a === "failed"
    ? "bad"
    : a === "skipped"
      ? "warn"
      : a === "up-to-date"
        ? "neutral"
        : "good";

/** The per-repo result of Sync all: pulled, pushed, conflict, skipped and why. */
export function SyncReportDialog() {
  const report = useUi((s) => s.syncReport);
  const close = useUi((s) => s.setSyncReport);
  useEscape(() => close(null), report !== null);
  if (!report) return null;
  // The brain's own repos are reported by the hub tool, under ids that start with hub:.
  const projects = report.repos.filter((r) => !r.id.startsWith("hub:"));
  const notes = report.repos.filter((r) => r.id.startsWith("hub:"));
  return (
    <div className="dialog-backdrop" data-testid="sync-report">
      <div
        className="flex max-h-[80vh] w-[640px] flex-col rounded border"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <h2 className="m-0 text-sm font-semibold">Sync all: {report.repos.length} repos</h2>
          <Button variant="ghost" aria-label="Close" onClick={() => close(null)}>
            <X size={14} />
          </Button>
        </header>
        <div className="flex-1 overflow-auto">
          {report.repos.length === 0 && (
            <EmptyState>Nothing to sync. Add projects in the workspace config.</EmptyState>
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
                <h3
                  className="m-0 border-b px-4 py-1.5 text-[12px] font-semibold uppercase"
                  style={{
                    borderColor: "var(--line)",
                    color: "var(--muted)",
                    background: "var(--rail)",
                  }}
                >
                  {title as string}
                </h3>
                <ul className="m-0 list-none p-0">
                  {(rows as SyncRepoResult[]).map((r) => (
                    <li
                      key={r.id}
                      className="flex items-start gap-3 border-b px-4 py-2"
                      style={{ borderColor: "var(--line)" }}
                      data-testid="sync-row"
                    >
                      <span className="w-44 shrink-0 font-medium">{r.name}</span>
                      <Chip tone={tone(r.action)}>{label[r.action]}</Chip>
                      <span className="flex-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
                        {r.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
