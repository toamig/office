import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

/** True in the Playwright runs (the helper sets OFFICE_E2E=1): nothing may appear on, or take focus from, the desktop. */
export const isE2E = (): boolean => process.env["OFFICE_E2E"] === "1";

/**
 * Window options that keep a window off every screen but still let it load, lay out and paint, so the page,
 * its keys (sendInputEvent) and its pixels (capturePage) work with nobody watching.
 */
export function unseenWindowOptions(): Pick<BrowserWindowConstructorOptions, "show" | "skipTaskbar"> & {
  paintWhenInitiallyHidden: true;
} {
  return { show: false, skipTaskbar: true, paintWhenInitiallyHidden: true };
}

/** The "was it ever shown" mark the e2e helper reads before it closes the app. */
export function watchVisibility(win: BrowserWindow): void {
  const mark = (): void => {
    (globalThis as { __officeShown?: boolean }).__officeShown = true;
  };
  win.on("show", mark);
  win.on("restore", mark);
}
