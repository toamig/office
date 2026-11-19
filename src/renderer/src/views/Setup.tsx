import { useState } from "react";
import { useQuery } from "../lib/hooks";
import { Button, Card, LinkButton, Page } from "../ui";
import { AboutPanel } from "./setup/AboutPanel";
import { AutomationsPanel } from "./setup/AutomationsPanel";
import { HooksPanel } from "./setup/HooksPanel";
import { InventoryPanel } from "./setup/InventoryPanel";
import { ModulesPanel } from "./setup/ModulesPanel";
import { PreferencesPanel } from "./setup/PreferencesPanel";
import { ProjectsStep } from "./setup/ProjectsStep";
import { ToolsPanel } from "./setup/ToolsPanel";
import { WorkspaceStep } from "./setup/WorkspaceStep";

/** Setup: the workspace, the tools table, preferences and the inventory, as plain settings. */
export function Setup() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [rerun, setRerun] = useState(false);
  const w = workspace.data;
  const showWizard = w !== undefined && rerun;
  return (
    <Page title="Setup" subtitle="Your tools, folders and preferences." testId="setup">
      <div className="setup-grid">
        {showWizard && (
          <div className="span-all">
            <Card
              title="Change the workspace"
              action={<Button onClick={() => setRerun(false)}>Cancel</Button>}
            >
              <WorkspaceStep
                onDone={() => {
                  setRerun(false);
                  workspace.reload();
                }}
              />
            </Card>
          </div>
        )}
        {w?.configured && !showWizard && (
          <Card
            title="Workspace"
            testId="panel-workspace"
            action={<Button onClick={() => setRerun(true)}>Change</Button>}
          >
            <dl className="ui-dl" data-testid="workspace-summary">
              <dt>Workspace folder</dt>
              <dd className="break-all">{w.workspaceRoot}</dd>
              <dt>Config file</dt>
              <dd className="break-all">{w.workspaceConfigPath}</dd>
              <dt>Projects folder</dt>
              <dd className="break-all">{w.projectsRoot}</dd>
              <dt>Projects</dt>
              <dd>{w.workspace?.projects.length ?? 0}</dd>
            </dl>
          </Card>
        )}
        {w?.configured && (
          <Card title="Projects folder" testId="panel-projects-folder">
            <ProjectsStep onDone={workspace.reload} />
          </Card>
        )}
        <ToolsPanel />
        <HooksPanel />
        <PreferencesPanel />
        {w?.configured && <AutomationsPanel />}
        <ModulesPanel />
        <AboutPanel />
        {w?.configured && <InventoryPanel />}
      </div>
    </Page>
  );
}

export { LinkButton as _unusedLinkButton };
