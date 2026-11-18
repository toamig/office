import { useState } from "react";
import { Button, Panel } from "../components/ui";
import { useQuery } from "../lib/hooks";
import { AutomationsPanel } from "./setup/AutomationsPanel";
import { HooksPanel } from "./setup/HooksPanel";
import { PreferencesPanel } from "./setup/PreferencesPanel";
import { InventoryPanel } from "./setup/InventoryPanel";
import { ToolsPanel } from "./setup/ToolsPanel";
import { WorkspaceWizard } from "./setup/WorkspaceWizard";

/** Setup: the first-run wizard, the tools table and the inventory. */
export function Setup() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [rerun, setRerun] = useState(false);
  const w = workspace.data;
  const showWizard = w !== undefined && (!w.configured || rerun);
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6" data-testid="setup">
      <h1 className="m-0 text-lg font-semibold">Setup</h1>
      {showWizard && (
        <WorkspaceWizard
          onDone={() => {
            setRerun(false);
            workspace.reload();
          }}
        />
      )}
      {w?.configured && !showWizard && (
        <Panel title="Workspace" action={<Button onClick={() => setRerun(true)}>Change</Button>}>
          <div className="grid grid-cols-[150px_1fr] gap-y-1" data-testid="workspace-summary">
            <span style={{ color: "var(--muted)" }}>Workspace folder</span>
            <span className="break-all">{w.workspaceRoot}</span>
            <span style={{ color: "var(--muted)" }}>Config file</span>
            <span>{w.workspaceConfigPath}</span>
            <span style={{ color: "var(--muted)" }}>Projects folder</span>
            <span className="break-all">{w.projectsRoot}</span>
            <span style={{ color: "var(--muted)" }}>Projects</span>
            <span>{w.workspace?.projects.length ?? 0}</span>
          </div>
        </Panel>
      )}
      <ToolsPanel />
      <HooksPanel />
      <PreferencesPanel />
      {w?.configured && <AutomationsPanel />}
      {w?.configured && <InventoryPanel />}
    </div>
  );
}
