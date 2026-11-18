import { BrowserWindow, dialog, shell } from "electron";
import type { AppContext } from "./context";
import { run } from "./core/exec";
import { IpcFailure } from "./core/ipc";

/** Handlers that need Electron itself (opening folders and editors). Registered by the app only. */
export function registerShellHandlers(ctx: AppContext): void {
  const folderOf = (id: string): string => {
    const project = ctx.projects.find(id);
    if (!project) throw new IpcFailure("not-found", `No project with id ${id}`);
    return ctx.projects.absPath(project);
  };
  ctx.ipc.handle("setup.pickFolder", async (req) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: req.title ?? "Choose a folder",
      properties: ["openDirectory", "createDirectory"] as Array<
        "openDirectory" | "createDirectory"
      >,
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ctx.ipc.handle("projects.openFolder", async (req) => {
    const error = await shell.openPath(folderOf(req.id));
    if (error) throw new IpcFailure("open-failed", error);
  });
  ctx.ipc.handle("projects.openEditor", async (req) => {
    const result = await run(ctx.settings().editorCommand, [folderOf(req.id)], {
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      throw new IpcFailure(
        "editor-failed",
        `Could not start "${ctx.settings().editorCommand}": ${result.stderr.trim() || `exit ${result.code}`}`,
      );
    }
  });
}
