import { useState } from "react";
import type { InventoryItem } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { useQuery } from "../../lib/hooks";

const kinds: Array<[InventoryItem["kind"], string]> = [
  ["model", "Models"],
  ["skill", "Skills"],
  ["plugin", "Plugins"],
  ["mcp", "MCP servers"],
  ["hook", "Hooks"],
  ["notify", "Notify"],
];

/** A read-only list of what each agent tool has, and where it is defined (user or project). */
export function InventoryPanel() {
  const projects = useQuery("projects.list");
  const [projectId, setProjectId] = useState("");
  const inventory = useQuery("setup.inventory", projectId ? { projectId } : {});
  return (
    <Panel
      title="Inventory"
      action={
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Inventory project"
          className="rounded border px-1 py-0.5"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--text)" }}
        >
          <option value="">User level only</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              + {p.name}
            </option>
          ))}
        </select>
      }
    >
      {inventory.error && <ErrorBanner message={inventory.error} />}
      {inventory.loading && <EmptyState>Reading tool settings...</EmptyState>}
      <div data-testid="inventory">
        {inventory.data?.map((inv) => (
          <div key={inv.provider} className="mb-4" data-testid="inventory-provider">
            <h3 className="m-0 mb-1 text-[13px] font-semibold">{inv.label}</h3>
            {inv.items.length === 0 && <EmptyState>Nothing found.</EmptyState>}
            {kinds.map(([kind, label]) => {
              const items = inv.items.filter((i) => i.kind === kind);
              if (items.length === 0) return null;
              return (
                <div key={kind} className="mb-2">
                  <div className="text-[12px] uppercase" style={{ color: "var(--muted)" }}>
                    {label} ({items.length})
                  </div>
                  {items.map((i) => (
                    <div
                      key={`${i.name}-${i.detail ?? ""}-${i.source}`}
                      className="flex items-start gap-2 py-0.5"
                    >
                      <Chip>{i.source}</Chip>
                      <span className="font-medium">{i.name}</span>
                      {i.detail && (
                        <span className="break-all" style={{ color: "var(--muted)" }}>
                          {i.detail}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Button variant="ghost" onClick={inventory.reload}>
        Refresh
      </Button>
    </Panel>
  );
}
