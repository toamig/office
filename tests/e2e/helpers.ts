import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { join } from "node:path";
import {
  prepareLaunch,
  repoRoot,
  type LaunchOptions as BaseLaunchOptions,
  type Prepared,
} from "../support/prepare";

export { FAKE_OWNER, pick, repoRoot, terminalText, useCleanGitConfig } from "../support/prepare";

export interface Launched extends Omit<Prepared, "env"> {
  app: ElectronApplication;
}

export interface LaunchOptions extends BaseLaunchOptions {
  /** Launch the packaged app from release/win-unpacked instead of the built sources. */
  packaged?: boolean;
}

/**
 * Makes closing the app fail the test if any Office window was ever shown or is visible on a display: a test
 * run must never appear on, or take focus from, the owner's desktop.
 */
function guardVisibility(app: ElectronApplication): void {
  const close = app.close.bind(app);
  app.close = async (): Promise<void> => {
    const seen = await app
      .evaluate(({ BrowserWindow }) => ({
        everShown: (globalThis as { __officeShown?: boolean }).__officeShown === true,
        visible: BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length,
      }))
      .catch(() => null);
    await close();
    if (seen && (seen.everShown || seen.visible > 0)) {
      throw new Error(
        `An Office window was shown during the test run (shown: ${seen.everShown}, visible now: ${seen.visible}).`,
      );
    }
  };
}

export const packagedExe = join(repoRoot, "release", "win-unpacked", "Office.exe");

/** Launches the built app against a fresh data folder and a fake home. Never touches real data. */
export async function launch(options: LaunchOptions = {}): Promise<Launched> {
  // Every launch takes its own relay port, so runs side by side never meet.
  const prepared = prepareLaunch(options, 0);
  const { env, ...rest } = prepared;
  const app = await electron.launch({
    ...(options.packaged ? { executablePath: packagedExe } : {}),
    args: options.packaged ? [] : [repoRoot],
    env: { ...process.env, OFFICE_E2E: "1", ...env } as Record<string, string>,
  });
  guardVisibility(app);
  return { app, ...rest };
}
