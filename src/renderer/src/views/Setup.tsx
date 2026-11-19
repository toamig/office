import { useState } from "react";
import { Button, Panel } from "../components/ui";
import { useQuery } from "../lib/hooks";
import { AboutPanel } from "./setup/AboutPanel";
import { AutomationsPanel } from "./setup/AutomationsPanel";
import { HooksPanel } from "./setup/HooksPanel";
import { ModulesPanel } from "./setup/ModulesPanel";
import { PreferencesPanel } from "./setup/PreferencesPanel";
import { InventoryPanel } from "./setup/InventoryPanel";
import { ToolsPanel } from "./setup/ToolsPanel";
import { ProjectsStep } from "./setup/ProjectsStep";
import { WorkspaceStep } from "./setup/WorkspaceStep";

/** Setup: the workspace, the tools table, preferences and the inventory, as plain settings. */
export function Setup() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [rerun, setRerun] = useState(false);
  const w = workspace.data;
  const showWizard = w !== undefined && rerun;
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6" data-testid="setup">
      <h1 className="m-0 text-lg font-semibold">Setup</h1>
      {showWizard && (
        <Panel
          title="Change the workspace"
          action={<Button onClick={() => setRerun(false)}>Cancel</Button>}
        >
          <WorkspaceStep
            onDone={() => {
              setRerun(false);
              workspace.reload();
            }}
          />
        </Panel>
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
      {w?.configured && (
        <Panel title="Projects folder">
          <ProjectsStep onDone={workspace.reload} />
        </Panel>
      )}
      <ToolsPanel />
      <HooksPanel />
      <PreferencesPanel />
      {w?.configured && <AutomationsPanel />}
      <ModulesPanel />
      <AboutPanel />
      {w?.configured && <InventoryPanel />}
    </div>
  );
}
