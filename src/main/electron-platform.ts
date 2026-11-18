import { BrowserWindow, dialog, Menu, shell } from "electron";
import type { AppContext } from "./context";
import { currentChrome } from "./chrome";
import { terminalMenu } from "./core/context-menu";
import type { UpdateService } from "./core/update";
import type { PreviewPane } from "./preview";
import type { ShellPlatform } from "./shell-platform";

const targetWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** The real Electron behind the shell handlers: native menus, the folder dialog, the shell, the preview pane. */
export function createElectronPlatform(
  ctx: AppContext,
  preview: PreviewPane,
  updates: UpdateService,
): ShellPlatform {
  return {
    chrome: () => currentChrome(),
    popupMenu: (items) => {
      const window = targetWindow();
      if (!window || items.length === 0) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => {
        let chosen: string | null = null;
        const menu = Menu.buildFromTemplate(
          items.map((item) => ({
            label: item.label,
            enabled: item.enabled !== false,
            click: () => {
              chosen = item.id;
            },
          })),
        );
        menu.popup({ window, callback: () => resolve(chosen) });
      });
    },
    terminalMenu: (hasSelection) => {
      const window = targetWindow();
      if (!window) return;
      const menu = Menu.buildFromTemplate(
        terminalMenu(hasSelection).map((entry) =>
          entry === "separator"
            ? { type: "separator" as const }
            : {
                label: entry.label,
                enabled: entry.enabled,
                click: () => ctx.bus.emit("app.terminal-action", entry.action),
              },
        ),
      );
      menu.popup({ window });
    },
    pickFolder: async (title) => {
      const win = targetWindow();
      const options = {
        title: title ?? "Choose a folder",
        properties: ["openDirectory", "createDirectory"] as Array<
          "openDirectory" | "createDirectory"
        >,
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    openPath: (path) => shell.openPath(path),
    preview: {
      open: (url) => preview.open(url),
      setBounds: (bounds) => preview.setBounds(bounds),
      act: (action) => preview.act(action),
      state: () => preview.state(),
    },
    updates: {
      status: () => updates.status(),
      check: () => updates.check(),
      installNow: () => updates.installNow(),
    },
  };
}
