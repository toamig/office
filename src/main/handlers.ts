import { workspaceView, type AppContext } from "./context";
import { resolveCommand, resolveTool } from "./core/exec";
import { IpcFailure } from "./core/ipc";
import { readVaultFile } from "./modules/ask/ask";
import { readAudit } from "./modules/vault/audit";
import { captureSession } from "./modules/sessions/capture";
import { getLayout, setLayout } from "./modules/sessions/layouts";
import { userHome } from "./core/paths";
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
  ctx.ipc.handle("sessions.list", (req) => ctx.sessions.list(req));
  ctx.ipc.handle("sessions.start", (req) => ctx.sessions.start(req));
  ctx.ipc.handle("sessions.startCommand", (req) => {
    // A raw command channel is for tests and logins only; it is off unless the environment opts in.
    if (process.env["OFFICE_ALLOW_RAW_TERMINAL"] !== "1") {
      throw new IpcFailure("forbidden", "Raw terminals are disabled");
    }
    const resolved = resolveCommand(resolveTool(req.cmd) ?? req.cmd, req.args);
    return ctx.sessions.startCommand(
      { cmd: resolved.file, args: resolved.args },
      req.title,
      req.cwd ?? userHome(),
    );
  });
  ctx.ipc.handle("sessions.history", (req) => ctx.sessions.history(req.id));
  ctx.ipc.handle("sessions.kill", (req) => ctx.sessions.kill(req.id));
  ctx.ipc.handle("sessions.resume", (req) => ctx.sessions.resume(req.id));
  ctx.ipc.handle("sessions.archive", (req) => ctx.sessions.archive(req.id));
  ctx.ipc.handle("sessions.rename", (req) => ctx.sessions.rename(req.id, req.title));
  ctx.ipc.handle("layout.get", (req) => getLayout(ctx.db, req.key));
  ctx.ipc.handle("layout.set", (req) => setLayout(ctx.db, req.key, req.layout));
  ctx.ipc.handle("hooks.status", () => ctx.hooks.status());
  ctx.ipc.handle("hooks.preview", (req) => ctx.hooks.preview(req.target, req.action));
  ctx.ipc.handle("hooks.apply", (req) => ctx.hooks.apply(req.target, req.action));
  ctx.ipc.handle("capture.run", (req) => captureSession(ctx, req.id));
  ctx.ipc.handle("capture.commit", async (req) => {
    const session = ctx.sessions.get(req.id);
    const kept = req.items.filter((i) => i.dest !== "drop" && i.text.trim());
    if (kept.length > 0 && !session.projectId) {
      throw new IpcFailure(
        "no-project",
        "This session is not tied to a project, so there is nowhere to save items",
      );
    }
    const source = `from the ${session.title ?? session.provider} session`;
    for (const item of kept) {
      if (!session.projectId) break;
      if (item.dest === "waiting") await ctx.ops.addWaiting(session.projectId, item.text, source);
      else await ctx.ops.addTodo(session.projectId, item.text, source);
    }
    ctx.sessions.markCaptured(req.id);
    ctx.sessions.archive(req.id);
    return { saved: kept.length };
  });
  ctx.ipc.handle("ask.start", (req) => ({ runId: ctx.ask.start(req.question, req.projectId) }));
  ctx.ipc.handle("ask.result", (req) => ctx.ask.result(req.runId));
  ctx.ipc.handle("ask.cancel", (req) => ctx.ask.cancel(req.runId));
  ctx.ipc.handle("vault.readFile", (req) => readVaultFile(ctx.settings().workspaceRoot, req.path));
  ctx.ipc.handle("vault.audit", () => readAudit(ctx.settings().workspaceRoot));
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
