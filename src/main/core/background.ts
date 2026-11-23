import { workflowsFor } from "../../shared/workflow";
import type { Workspace } from "../../shared/types";

/** Whether any workflow is switched on: Office then has work to do while its window is closed. */
export function workflowsOn(workspace: Workspace | null): boolean {
  return workflowsFor(workspace).some((workflow) => workflow.enabled && workflow.schedule !== null);
}

/** Start Office with Windows: the owner's choice, and on by default once a scheduled workflow is on. */
export function startsWithWindows(choice: boolean | undefined, workspace: Workspace | null): boolean {
  return choice ?? workflowsOn(workspace);
}

/** Closing the window keeps Office in the tray while a scheduled workflow is on. */
export function staysInTray(workspace: Workspace | null): boolean {
  return workflowsOn(workspace);
}

/** The flag the login item passes, so Office starts minimised to the tray. */
export const HIDDEN_FLAG = "--hidden";

export function startedHidden(argv: string[]): boolean {
  return argv.includes(HIDDEN_FLAG);
}
