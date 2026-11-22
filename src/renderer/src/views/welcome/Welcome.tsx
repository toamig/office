import { Check } from "lucide-react";
import { useState } from "react";
import type { SetupState } from "@shared/models";
import { Button } from "../../ui";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { AddProjects } from "../onboarding/AddProjects";
import { HooksPanel } from "../setup/HooksPanel";
import { GlobalRulesPanel } from "../setup/GlobalRulesPanel";
import { ProjectsStep } from "../setup/ProjectsStep";
import { ToolsStep } from "../setup/ToolsStep";
import { WorkspaceStep } from "../setup/WorkspaceStep";

type StepId = SetupState["steps"][number]["id"];

const COPY: Record<StepId, { title: string; lead: string }> = {
  workspace: {
    title: "Your workspace",
    lead: "The git repo where Office keeps your projects, roles and notes.",
  },
  projects: {
    title: "Your projects folder",
    lead: "Where the code for your projects lives on this PC.",
  },
  tools: {
    title: "Your tools",
    lead: "Git, and at least one agent tool you are logged in to.",
  },
  add: {
    title: "Your projects",
    lead: "Optional. Add the code repos Office should know about; you can do this later from Projects.",
  },
  notifications: {
    title: "Agent notifications",
    lead: "Optional. Lets Office know the moment an agent needs you.",
  },
  instructions: {
    title: "Agent instructions",
    lead: "Review the Brain rules Office can add to Claude Code and Codex.",
  },
};

const BUTTONS_CLEARANCE =
  "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))";

/**
 * The first-run flow, in the whole window and nothing else: a progress line, one step at a time, Back and
 * Continue. No sidebar and no views until the required steps are met (spec 4.8). A required step that breaks
 * later (the workspace folder is gone) sends the flow back to that step.
 */
export function Welcome({ state }: { state: SetupState }) {
  const [picked, setStep] = useState<StepId>(state.current);
  const pickedIndex = state.steps.findIndex((s) => s.id === picked);
  const firstUnmet = state.steps.findIndex((s) => s.required && !s.met);
  // A required step that is not met (or has broken) pulls the flow back to it, and never lets it run ahead.
  const index = firstUnmet !== -1 && firstUnmet < pickedIndex ? firstUnmet : pickedIndex;
  const step = state.steps[index]?.id ?? picked;
  const here = state.steps[index];

  const finish = (): void => {
    void office.invoke("setup.complete");
  };
  const goTo = (i: number): void => {
    const next = state.steps[i];
    if (next) setStep(next.id);
  };
  const last = index === state.steps.length - 1;
  const unsaved = useUi((s) => Object.values(s.unsaved)[0]);
  const blocked = here?.required && !here.met ? here.reason : (unsaved ?? null);
  const copy = COPY[step];

  return (
    <div className="welcome" data-testid="welcome">
      <header className="topbar" style={{ paddingRight: BUTTONS_CLEARANCE }} data-testid="topbar">
        <span className="topbar-title">Welcome to Office</span>
      </header>
      <div className="welcome-body">
        <div className="welcome-card">
          <ol className="welcome-progress" data-testid="welcome-progress" aria-label="Progress">
            {state.steps.map((s, i) => (
              <li
                key={s.id}
                data-testid={`welcome-step-${s.id}`}
                data-state={i === index ? "current" : i < index && s.met ? "done" : "todo"}
                aria-current={i === index ? "step" : undefined}
              >
                <span className="welcome-dot">
                  {i < index && s.met ? <Check size={11} /> : i + 1}
                </span>
                {s.label}
                {!s.required && <span className="welcome-optional"> (optional)</span>}
              </li>
            ))}
          </ol>
          <h1 className="m-0 text-xl font-semibold" data-testid="welcome-title">
            {copy.title}
          </h1>
          <p className="mb-4 mt-1 ui-muted">{copy.lead}</p>
          <div className="welcome-step text-selectable" data-testid={`welcome-panel-${step}`}>
            {step === "workspace" && <WorkspaceStep />}
            {step === "projects" && <ProjectsStep />}
            {step === "tools" && <ToolsStep />}
            {step === "add" && <AddProjects />}
            {step === "notifications" && <HooksPanel title="" />}
            {step === "instructions" && <GlobalRulesPanel onboarding />}
          </div>
          <footer className="welcome-footer">
            <Button
              disabled={index <= 0}
              onClick={() => goTo(index - 1)}
              data-testid="welcome-back"
            >
              Back
            </Button>
            <span className="welcome-reason" data-testid="welcome-reason">
              {blocked ?? ""}
            </span>
            {last ? (
              <Button variant="primary" onClick={finish} data-testid="welcome-finish">
                {here?.met ? "Finish" : "Skip"}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={blocked !== null}
                onClick={() => goTo(index + 1)}
                data-testid="welcome-continue"
              >
                Continue
              </Button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
