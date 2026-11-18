import { BrowserWindow, dialog, Menu, shell } from "electron";
import { terminalMenu } from "./core/context-menu";
import type { AppContext } from "./context";
import type { UpdateService } from "./core/update";
import type { PreviewPane } from "./preview";
import { currentChrome } from "./chrome";
import { detectDevServer } from "./core/dev-server";
import { run } from "./core/exec";
import { IpcFailure } from "./core/ipc";
import { findUproject } from "./modules/projects/unreal";
import type { RunSummary } from "../shared/models";

/** Handlers that need Electron itself (opening folders and editors). Registered by the app only. */
export function registerShellHandlers(
  ctx: AppContext,
  preview: PreviewPane,
  updates: UpdateService,
): void {
  ctx.ipc.handle("app.chrome", () => currentChrome());
  ctx.ipc.handle("app.terminalMenu", (req) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!window) return;
    const menu = Menu.buildFromTemplate(
      terminalMenu(req.hasSelection).map((entry) =>
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
  });
  ctx.ipc.handle("app.update.status", () => updates.status());
  ctx.ipc.handle("app.update.check", () => updates.check());
  ctx.ipc.handle("app.update.install", () => updates.installNow());
  ctx.ipc.handle("preview.open", async (req) => {
    try {
      return await preview.open(req.url);
    } catch (err) {
      throw new IpcFailure("bad-url", (err as Error).message);
    }
  });
  ctx.ipc.handle("preview.bounds", (req) => preview.setBounds(req));
  ctx.ipc.handle("preview.act", (req) => preview.act(req.action));
  ctx.ipc.handle("preview.state", () => preview.state());
  ctx.ipc.handle("preview.detect", () => detectDevServer());
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
  ctx.ipc.handle("projects.unrealFile", (req) => findUproject(folderOf(req.id)));
  ctx.ipc.handle("projects.openUnreal", async (req) => {
    const file = findUproject(folderOf(req.id));
    if (!file) throw new IpcFailure("not-unreal", "This project has no .uproject file");
    // The file is opened with whatever the owner's PC has registered for it (the Unreal launcher).
    const error = await shell.openPath(file);
    if (error) throw new IpcFailure("open-failed", error);
  });
  ctx.ipc.handle(
    "projects.runs",
    (req) =>
      ctx.db
        .prepare(
          `SELECT id, kind, provider, model, status, started_at AS startedAt, ended_at AS endedAt, error
         FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 10`,
        )
        .all(req.id) as RunSummary[],
  );
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
