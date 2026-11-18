import { workspaceView, type AppContext } from "./context";

/** Registers every IPC handler. Grows by one block per module. */
export function registerHandlers(ctx: AppContext): void {
  ctx.ipc.handle("app.ping", (req) => ({ text: req.text, at: new Date().toISOString() }));
  ctx.ipc.handle("workspace.get", () => workspaceView(ctx));
}
