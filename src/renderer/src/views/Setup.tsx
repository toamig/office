import { useState } from "react";
import { useQuery } from "../lib/hooks";
import { Button, Card, Page } from "../ui";
import { AboutPanel } from "./setup/AboutPanel";
import { BackgroundAiPanel } from "./setup/BackgroundAiPanel";
import { BrainSyncPanel } from "./setup/BrainSyncPanel";
import { HooksPanel } from "./setup/HooksPanel";
import { ModulesPanel } from "./setup/ModulesPanel";
import { PreferencesPanel } from "./setup/PreferencesPanel";
import { ProjectsStep } from "./setup/ProjectsStep";
import { ToolsPanel } from "./setup/ToolsPanel";
import { RulePackPanel } from "./setup/RulePackPanel";
import { GlobalRulesPanel } from "./setup/GlobalRulesPanel";
import { GitRulesPanel } from "./setup/GitRulesPanel";
import { WorkspaceStep } from "./setup/WorkspaceStep";
import { PermissionsTab } from "./board/PermissionsTab";

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "folders", label: "Folders" },
  { id: "programs", label: "Agent programs" },
  { id: "rules", label: "Brain rules" },
  { id: "notifications", label: "Notifications" },
  { id: "background", label: "Background AI" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** Setup: a list of sections on the left and one section at a time on the right. */
export function Setup() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [rerun, setRerun] = useState(false);
  const [section, setSection] = useState<SectionId>("general");
  const w = workspace.data;
  const showWizard = w !== undefined && rerun;
  const configured = w?.configured === true;
  return (
    <Page title="Setup" subtitle="Your programs, folders and preferences." testId="setup">
      <div className="grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Setup sections" className="flex gap-1 md:flex-col" data-testid="setup-sections">
          {SECTIONS.map((entry) => (
            <button key={entry.id} type="button" className="sidebar-item" data-active={section === entry.id}
              data-testid={`setup-section-${entry.id}`} aria-current={section === entry.id ? "page" : undefined}
              onClick={() => setSection(entry.id)}>
              <span className="sidebar-label">{entry.label}</span>
            </button>
          ))}
        </nav>
        <div className="setup-grid min-w-0 content-start" data-testid={`setup-section-body-${section}`}>
          {section === "general" && <PreferencesPanel part="general" />}
          {section === "folders" && <>
            {showWizard && (
              <div className="span-all">
                <Card title="Change the workspace" action={<Button onClick={() => setRerun(false)}>Cancel</Button>}>
                  <WorkspaceStep onDone={() => { setRerun(false); workspace.reload(); }} />
                </Card>
              </div>
            )}
            {configured && !showWizard && (
              <Card title="Workspace" testId="panel-workspace" action={<Button onClick={() => setRerun(true)}>Change</Button>}>
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
            {configured && (
              <Card title="Projects folder" testId="panel-projects-folder">
                <ProjectsStep onDone={workspace.reload} />
              </Card>
            )}
            <PreferencesPanel part="folders" />
          </>}
          {section === "programs" && <ToolsPanel />}
          {section === "rules" && <>
            {configured && <RulePackPanel />}
            {configured && <GlobalRulesPanel />}
            {configured && <GitRulesPanel />}
            <BrainSyncPanel />
          </>}
          {section === "notifications" && <>
            <HooksPanel />
            <PreferencesPanel part="notifications" />
          </>}
          {section === "background" && configured && <BackgroundAiPanel />}
          {section === "advanced" && <>
            <ModulesPanel />
            {configured && <Card title="Permission profiles"><PermissionsTab /></Card>}
          </>}
          {section === "about" && <AboutPanel />}
        </div>
      </div>
    </Page>
  );
}
