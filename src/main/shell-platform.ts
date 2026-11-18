import type { PreviewBounds, PreviewState, UpdateStatus } from "../shared/models";

/** What the window chrome was last set to. */
export interface ChromeState {
  theme: "light" | "dark";
  background: string;
  overlayColor: string;
  overlaySymbol: string;
}

export interface MenuItemSpec {
  id: string;
  label: string;
  enabled?: boolean | undefined;
}

/**
 * Everything the handlers need from Electron itself (windows, menus, dialogs, the shell, the preview pane,
 * the updater), behind one small interface. The app gives it the real thing; the test host (M8) gives it a
 * version that does nothing or records what was asked, so the same handlers run without Electron.
 */
export interface ShellPlatform {
  chrome(): ChromeState;
  /** Pops up a menu where the pointer is; answers the id of the chosen item, or null. */
  popupMenu(items: MenuItemSpec[]): Promise<string | null>;
  /** The terminal's right-click menu; its choice comes back as an `app.terminal-action` event. */
  terminalMenu(hasSelection: boolean): void;
  /** The system folder picker; null when cancelled. */
  pickFolder(title?: string): Promise<string | null>;
  /** Opens a folder or file with the system's default program; answers an error text, or "" on success. */
  openPath(path: string): Promise<string>;
  preview: {
    open(url: string): Promise<PreviewState>;
    setBounds(bounds: PreviewBounds): void;
    act(action: "back" | "forward" | "reload" | "stop" | "external" | "close"): PreviewState;
    state(): PreviewState;
  };
  updates: {
    status(): UpdateStatus;
    check(): Promise<UpdateStatus>;
    installNow(): void;
  };
}
