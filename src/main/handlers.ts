import { workspaceView, type AppContext } from "./context";
import { IpcFailure } from "./core/ipc";
import { noteAndProjectItems, readNote } from "./modules/notes/notes";
import { detectTools } from "./modules/setup/detect";
import { readInventories } from "./modules/setup/inventory";
import {
  cloneWorkspaceRepo,
  inspectWorkspaceFolder,
  prepareWorkspace,
} from "./modules/setup/workspace-setup";
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
  ctx.ipc.handle("projects.refresh", async (req) => {
    if (req.id) await ctx.projects.refresh(req.id);
    else await ctx.projects.refreshAll();
  });
  ctx.ipc.handle("git.syncAll", () => ctx.sync());
  ctx.ipc.handle("git.syncProject", (req) => ctx.syncProject(req.id));
  ctx.ipc.handle("notes.read", (req) =>
    readNote(ctx.store.state.workspace, ctx.settings().workspaceRoot, req.projectId, req.name),
  );
  ctx.ipc.handle("search.items", () =>
    noteAndProjectItems(ctx.store.state.workspace, ctx.settings().workspaceRoot),
  );

  ctx.ipc.handle("setup.detectTools", () => detectTools());
  ctx.ipc.handle("setup.inspect", (req) => inspectWorkspaceFolder(req.root));
  ctx.ipc.handle("setup.clone", (req) => cloneWorkspaceRepo(req.url, req.dest));
  ctx.ipc.handle("setup.apply", async (req) => {
    prepareWorkspace(req);
    ctx.patchSettings({
      workspaceRoot: req.workspaceRoot,
      workspaceConfigPath: req.workspaceConfigPath,
      projectsRoot: req.projectsRoot,
    });
    await ctx.start();
    return workspaceView(ctx);
  });
  ctx.ipc.handle("setup.inventory", (req) => {
    const project = req.projectId ? ctx.projects.find(req.projectId) : undefined;
    return readInventories(project ? ctx.projects.absPath(project) : undefined);
  });

  ctx.ipc.handle("providers.list", () =>
    Promise.all(
      ctx.providers.all().map(async (p) => {
        const [d, models] = await Promise.all([p.detect(), p.models()]);
        return {
          id: p.id,
          label: p.label,
          installed: d.installed,
          loggedIn: d.installed ? d.loggedIn : null,
          models,
          ...(d.version ? { version: d.version } : {}),
          ...(d.problem ? { problem: d.problem } : {}),
        };
      }),
    ),
  );
  ctx.ipc.handle("notifications.list", (req) => ctx.notifier.list(req));
  ctx.ipc.handle("notifications.markRead", (req) => ctx.notifier.markRead(req.ids));
  ctx.ipc.handle("notifications.counts", () => ({
    unread: ctx.notifier.unreadCount(),
    urgentUnread: ctx.notifier.unreadUrgentCount(),
  }));

  ctx.ipc.handle("vault.openItems", (req) => ctx.vault.read(req.projectId));
  ctx.ipc.handle("vault.waiting", () => ctx.vault.allWaiting());
  ctx.ipc.handle("vault.tickWaiting", (req) => ctx.ops.tickWaiting(req.projectId, req.raw));
  ctx.ipc.handle("vault.addWaiting", (req) =>
    ctx.ops.addWaiting(req.projectId, req.text, req.source),
  );
  ctx.ipc.handle("vault.addNote", (req) => ctx.ops.addNote(req.projectId, req.text));
  ctx.ipc.handle("vault.health", async () => {
    const root = ctx.settings().workspaceRoot;
    const kind = ctx.store.state.workspace?.vault.kind;
    if (!root || kind !== "brain-hub") {
      return {
        validate: { ran: false, ok: true, errors: [], warnings: 0, summary: null },
        repos: [],
        warnings: ctx.warnings,
      };
    }
    const [validate, repos] = await Promise.all([runValidate(root), readHubStatus(root)]);
    return { validate, repos, warnings: ctx.warnings };
  });
}
