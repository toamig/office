import { workspaceView, type AppContext } from "./context";
import { IpcFailure } from "./core/ipc";

/** Registers every IPC handler. Grows by one block per module. */
export function registerHandlers(ctx: AppContext): void {
  ctx.ipc.handle("app.ping", (req) => ({ text: req.text, at: new Date().toISOString() }));
  ctx.ipc.handle("workspace.get", () => workspaceView(ctx));
  ctx.ipc.handle("projects.list", () => ctx.projects.list());
  ctx.ipc.handle("projects.get", async (req) => {
    const detail = await ctx.projects.get(req.id);
    if (!detail) throw new IpcFailure("not-found", `No project with id ${req.id}`);
    return detail;
  });
  ctx.ipc.handle("projects.refresh", async (req) => {
    if (req.id) await ctx.projects.refresh(req.id);
    else await ctx.projects.refreshAll();
  });
}
