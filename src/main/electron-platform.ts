import { BrowserWindow, dialog, Menu, shell } from "electron";
import type { AppContext } from "./context";
import { currentChrome } from "./chrome";
import { terminalMenu } from "./core/context-menu";
import type { UpdateService } from "./core/update";
import { PreviewPane } from "./preview";
import { ChatFilePreview } from "./chat-file-preview";
import type { ShellPlatform } from "./shell-platform";

const targetWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** The real Electron behind the shell handlers: native menus, the folder dialog, the shell, the preview pane. */
export function createElectronPlatform(
  ctx: AppContext,
  preview: PreviewPane,
  updates: UpdateService,
): ShellPlatform {
  const files = new ChatFilePreview(targetWindow, (id) => ctx.chat.fileScope(id));
  const previews = new Map<string, PreviewPane>();
  const pane = (owner?: string): PreviewPane => {
    if (!owner) return preview;
    let selected = previews.get(owner);
    if (!selected) {
      selected = new PreviewPane(() => targetWindow() ?? null, (state) => ctx.bus.emit("preview.state", { ...state, owner }));
      previews.set(owner, selected);
    }
    return selected;
  };
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
    revealPath: (path) => shell.showItemInFolder(path),
    filePreview: {
      open: (id, file) => files.open(id, file),
      setBounds: (id, bounds) => files.setBounds(id, bounds),
      close: (id) => files.close(id),
    },
    preview: {
      open: (url, owner) => pane(owner).open(url),
      setBounds: (bounds, owner) => pane(owner).setBounds(bounds),
      act: (action, owner) => {
        const state = pane(owner).act(action);
        if (action === "close" && owner) previews.delete(owner);
        return state;
      },
      state: (owner) => pane(owner).state(),
    },
    updates: {
      status: () => updates.status(),
      check: () => updates.check(),
      installNow: () => updates.installNow(),
    },
  };
}
