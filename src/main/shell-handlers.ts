import { shell } from "electron";
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
