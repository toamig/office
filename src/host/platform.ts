import type { PreviewState } from "../shared/models";
import type { UpdateService } from "../main/core/update";
import { chromeColors } from "../shared/theme";
import type { MenuItemSpec, ShellPlatform } from "../main/shell-platform";

const EMPTY_PREVIEW: PreviewState = {
  open: false,
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  error: null,
};

/** What a test can script and read back from the host's no-op shell. */
export interface HostPlatformState {
  /** Answers for the next native menus and folder dialogs, oldest first. */
  menuAnswers: Array<string | null>;
  folderAnswers: Array<string | null>;
  /** Everything the handlers asked the shell to do. */
  calls: Array<{ what: string; arg?: unknown }>;
}

/**
 * The shell of the test host: no windows, menus or dialogs, so each call is recorded and answered from what the
 * test scripted. The handlers behind it are the same ones the app registers.
 */
export function createHostPlatform(updates: UpdateService): {
  platform: ShellPlatform;
  state: HostPlatformState;
} {
  const state: HostPlatformState = { menuAnswers: [], folderAnswers: [], calls: [] };
  const note = (what: string, arg?: unknown): void => {
    state.calls.push({ what, ...(arg === undefined ? {} : { arg }) });
  };
  const dark = chromeColors("dark");
  const platform: ShellPlatform = {
    chrome: () => ({
      theme: "dark",
      background: dark.background,
      overlayColor: dark.overlayColor,
      overlaySymbol: dark.overlaySymbol,
    }),
    popupMenu: async (items: MenuItemSpec[]) => {
      note("popupMenu", items);
      return state.menuAnswers.shift() ?? null;
    },
    terminalMenu: (hasSelection) => note("terminalMenu", hasSelection),
    pickFolder: async (title) => {
      note("pickFolder", title);
      return state.folderAnswers.shift() ?? null;
    },
    openPath: async (path) => {
      note("openPath", path);
      return "";
    },
    preview: {
      open: async () => {
        throw new Error("The preview pane needs the desktop app");
      },
      setBounds: () => undefined,
      act: () => EMPTY_PREVIEW,
      state: () => EMPTY_PREVIEW,
    },
    updates: {
      status: () => updates.status(),
      check: () => updates.check(),
      installNow: () => updates.installNow(),
    },
  };
  return { platform, state };
}
