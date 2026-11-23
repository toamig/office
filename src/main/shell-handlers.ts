import type { AppContext } from "./context";
import { detectDevServer } from "./core/dev-server";
import { run } from "./core/exec";
import { IpcFailure } from "./core/ipc";
import { notePath } from "./modules/notes/notes";
import { findUproject } from "./modules/projects/unreal";
import type { ShellPlatform } from "./shell-platform";
import type { RunSummary } from "../shared/models";
import { describeChatFile, isHtmlFile, isPdfFile, scopedFile } from "./modules/chat/files";

/** Handlers that reach Electron through the platform (menus, dialogs, the shell, the preview pane, the updater). */
export function registerShellHandlers(ctx: AppContext, platform: ShellPlatform): void {
  ctx.ipc.handle("app.chrome", () => platform.chrome());
  ctx.ipc.handle("app.popupMenu", (req) => platform.popupMenu(req.items));
  ctx.ipc.handle("app.terminalMenu", (req) => platform.terminalMenu(req.hasSelection));
  ctx.ipc.handle("app.update.status", () => platform.updates.status());
  ctx.ipc.handle("app.update.check", () => platform.updates.check());
  ctx.ipc.handle("app.update.install", () => platform.updates.installNow());
  ctx.ipc.handle("preview.open", async (req) => {
    try {
      return await platform.preview.open(req.url, req.owner);
    } catch (err) {
      throw new IpcFailure("bad-url", (err as Error).message);
    }
  });
  ctx.ipc.handle("preview.bounds", (req) => platform.preview.setBounds(req, req.owner));
  ctx.ipc.handle("preview.act", (req) => platform.preview.act(req.action, req.owner));
  ctx.ipc.handle("preview.state", (req) => platform.preview.state(req?.owner));
  ctx.ipc.handle("preview.detect", () => detectDevServer());
  const fileRequests = new Map<string, symbol>();
  const chatFile = (id: string, path: string) => scopedFile(ctx.chat.fileScope(id), path);
  ctx.ipc.handle("chat.file", async (req) => describeChatFile(await chatFile(req.id, req.path)));
  ctx.ipc.handle("chat.fileAction", async (req) => {
    const file = await chatFile(req.id, req.path);
    if (req.action === "reveal") return platform.revealPath?.(file);
    const error = await platform.openPath(file);
    if (error) throw new IpcFailure("open-failed", error);
  });
  ctx.ipc.handle("chat.previewFile", async (req) => {
    if (!platform.filePreview) throw new IpcFailure("no-preview", "File previews need the desktop app.");
    const request = Symbol();
    fileRequests.set(req.id, request);
    try {
      const file = await chatFile(req.id, req.path);
      if (fileRequests.get(req.id) !== request) return;
      if (!isHtmlFile(file) && !isPdfFile(file)) throw new IpcFailure("no-preview", "This file does not use a native preview.");
      await platform.filePreview.open(req.id, file);
    } finally {
      if (fileRequests.get(req.id) === request) fileRequests.delete(req.id);
    }
  });
  ctx.ipc.handle("chat.previewFileBounds", (req) => platform.filePreview?.setBounds(req.id, req));
  ctx.ipc.handle("chat.closeFilePreview", (req) => {
    fileRequests.delete(req.id);
    platform.filePreview?.close(req.id);
  });
  const folderOf = (id: string): string => {
    const project = ctx.projects.find(id);
    if (!project) throw new IpcFailure("not-found", `No project with id ${id}`);
    return ctx.projects.absPath(project);
  };
  ctx.ipc.handle("setup.pickFolder", (req) => platform.pickFolder(req.title));
  ctx.ipc.handle("projects.openFolder", async (req) => {
    const error = await platform.openPath(folderOf(req.id));
    if (error) throw new IpcFailure("open-failed", error);
  });
  ctx.ipc.handle("projects.unrealFile", (req) => findUproject(folderOf(req.id)));
  ctx.ipc.handle("projects.openUnreal", async (req) => {
    const file = findUproject(folderOf(req.id));
    if (!file) throw new IpcFailure("not-unreal", "This project has no .uproject file");
    // The file is opened with whatever the owner's PC has registered for it (the Unreal launcher).
    const error = await platform.openPath(file);
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
  ctx.ipc.handle("notes.openFile", async (req) => {
    const file = notePath(
      ctx.store.state.workspace,
      ctx.settings().workspaceRoot,
      req.projectId,
      req.name,
    );
    if (!file) throw new IpcFailure("no-note", "That note is not in the brain");
    const result = await run(ctx.settings().editorCommand, [file], { timeoutMs: 15_000 });
    if (result.code !== 0)
      throw new IpcFailure(
        "editor-failed",
        `Could not start "${ctx.settings().editorCommand}": ${result.stderr.trim() || `exit ${result.code}`}`,
      );
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
