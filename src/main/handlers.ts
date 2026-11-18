import { workspaceView, type AppContext } from "./context";
import { IpcFailure } from "./core/ipc";
import { readHubStatus, runValidate } from "./modules/vault/health";

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
  ctx.ipc.handle("git.syncAll", () => ctx.sync());
  ctx.ipc.handle("vault.openItems", (req) => ctx.vault.read(req.projectId));
  ctx.ipc.handle("vault.waiting", () => ctx.vault.allWaiting());
  ctx.ipc.handle("vault.health", async () => {
    const root = ctx.settings().workspaceRoot;
    const kind = ctx.store.state.workspace?.vault.kind;
    if (!root || kind !== "brain-hub") {
      return {
        validate: { ran: false, ok: true, errors: [], warnings: 0, summary: null },
        repos: [],
        warnings: [],
      };
    }
    const [validate, repos] = await Promise.all([runValidate(root), readHubStatus(root)]);
    return { validate, repos, warnings: [] };
  });
  ctx.ipc.handle("projects.refresh", async (req) => {
    if (req.id) await ctx.projects.refresh(req.id);
    else await ctx.projects.refreshAll();
  });
}
