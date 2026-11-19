import { useState } from "react";
import type { InventoryItem } from "@shared/models";
import { useQuery } from "../../lib/hooks";
import { Button, Card, Dropdown, EmptyState, Group, Skeleton } from "../../ui";

const kinds: Array<[InventoryItem["kind"], string]> = [
  ["model", "Models"],
  ["skill", "Skills"],
  ["plugin", "Plugins"],
  ["mcp", "MCP servers"],
  ["hook", "Hooks"],
  ["notify", "Notify command"],
];

const SOURCE: Record<string, string> = { user: "Your settings", project: "This project" };

/** A read-only list of what each agent tool has, and where it is defined (user or project). */
export function InventoryPanel() {
  const projects = useQuery("projects.list");
  const [projectId, setProjectId] = useState("");
  const inventory = useQuery("setup.inventory", projectId ? { projectId } : {});
  return (
    <Card
      title="Inventory"
      testId="panel-inventory"
      action={
        <Dropdown
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Inventory project"
        >
          <option value="">Your settings only</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              Also {p.name}
            </option>
          ))}
        </Dropdown>
      }
    >
      {inventory.error && <p className="ui-bad">{inventory.error}</p>}
      {inventory.loading && !inventory.data && <Skeleton width={24} />}
      <div data-testid="inventory">
        {inventory.data?.map((inv) => (
          <section key={inv.provider} data-testid="inventory-provider">
            <Group>{inv.label}</Group>
            {inv.items.length === 0 && (
              <EmptyState title="Nothing found">
                This tool has no settings of these kinds.
              </EmptyState>
            )}
            {kinds.map(([kind, label]) => {
              const items = inv.items.filter((i) => i.kind === kind);
              if (items.length === 0) return null;
              return (
                <div key={kind} className="mb-2">
                  <div className="ui-line-sub">
                    {label} ({items.length})
                  </div>
                  {items.map((i) => (
                    <div
                      key={`${i.name}-${i.detail ?? ""}-${i.source}`}
                      className="flex items-start gap-2 py-1"
                    >
                      <span className="ui-muted w-28 shrink-0">{SOURCE[i.source] ?? i.source}</span>
                      <span className="font-medium">{i.name}</span>
                      {i.detail && <span className="break-all ui-muted">{i.detail}</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <Button variant="ghost" onClick={inventory.reload}>
        Refresh
      </Button>
    </Card>
  );
}
