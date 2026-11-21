import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppSettings, GithubOverview, Inventory, ProviderStatus } from "../shared/models";
import { workspaceView, type AppContext } from "./context";
import { resolveCommand, resolveTool } from "./core/exec";
import { normPath } from "./core/util";
import { loadWorkspaceFile } from "./core/workspace";
import { scanProjectsRoot, suggestRoots, type ProjectRef } from "./modules/setup/projects-folder";
import { BackgroundCache } from "./core/background-cache";
import { IpcFailure } from "./core/ipc";
import {
  cleanMergedBranches,
  compareBranches,
  createBranch,
  deleteBranch,
  listBranches,
  switchBranch,
} from "./modules/git/branches";
import {
  cleanMergedWorktrees,
  createWorktree,
  listWorktrees,
  removeWorktree,
} from "./modules/git/worktrees";
import { commitFiles, pushCurrent } from "./modules/git/commit";
import { readGraph, showCommit } from "./modules/git/graph";
import { git } from "./modules/git/run";
import { getDiff } from "./modules/git/diff";
import { readStatus } from "./modules/git/status";
import { sendReviewToAgent } from "./modules/sessions/review";
import { readVaultFile } from "./modules/ask/ask";
import { readAudit } from "./modules/vault/audit";
import {
  getDock,
  getLayout,
  listDock,
  removeDock,
  setDock,
  setLayout,
} from "./modules/sessions/layouts";
import { userHome } from "./core/paths";
import { noteEntries, readNote } from "./modules/notes/notes";
import { buildSearchItems } from "./modules/search/items";
import { readInventories } from "./modules/setup/inventory";
import {
  cloneWorkspaceRepo,
  inspectWorkspaceFolder,
  prepareWorkspace,
} from "./modules/setup/workspace-setup";
import { installSession, installTool, loginSession, loginTool } from "./modules/setup/tool-actions";
import { rememberCodexModel } from "./modules/providers/codex";

/** Registers every IPC handler, one group at a time. */
export function registerHandlers(ctx: AppContext): void {
  registerProjectHandlers(ctx);
  registerSetupHandlers(ctx);
  registerSessionHandlers(ctx);
  registerBrainHandlers(ctx);
  registerGitHandlers(ctx);
  registerConfigHandlers(ctx);
  registerTaskHandlers(ctx);
  registerVaultHandlers(ctx);
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Projects, notes and the quick switcher. */
function registerProjectHandlers(ctx: AppContext): void {
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
  ctx.ipc.handle("notes.list", (req) =>
    noteEntries(ctx.store.state.workspace, ctx.settings().workspaceRoot, req.projectId),
  );
  ctx.ipc.handle("notes.read", (req) =>
    readNote(ctx.store.state.workspace, ctx.settings().workspaceRoot, req.projectId, req.name),
  );
  ctx.ipc.handle("search.items", () =>
    buildSearchItems({
      workspace: ctx.store.state.workspace,
      workspaceRoot: ctx.settings().workspaceRoot,
      projects: ctx.projects,
      sessions: ctx.sessions,
      extraSources: () => ctx.modules.searchSources(),
    }),
  );
}

/** Setup: tools, the workspace folder and providers. */
function registerSetupHandlers(ctx: AppContext): void {
  ctx.ipc.handle("setup.detectTools", () => ctx.toolsMonitor.read());
  ctx.ipc.handle("setup.recheckTools", () => ctx.toolsMonitor.check());
  ctx.ipc.handle("setup.state", () => ctx.setupState());
  /** The projects of the workspace config, read from the file, so this works before the workspace is open. */
  const configuredProjects = (): ProjectRef[] => {
    const s = ctx.settings();
    if (!s.workspaceRoot || !s.workspaceConfigPath) return [];
    const loaded = loadWorkspaceFile(join(s.workspaceRoot, s.workspaceConfigPath));
    return loaded.ok
      ? loaded.workspace.projects
          .filter((p) => !p.archived)
          .map((p) => ({ id: p.id, name: p.name, path: p.path }))
      : [];
  };
  ctx.ipc.handle("setup.scanProjectsRoot", (req) =>
    scanProjectsRoot(configuredProjects(), resolve(req.path), ctx.settings().projectPaths),
  );
  ctx.ipc.handle("setup.suggestProjectsRoot", () => {
    const projects = configuredProjects();
    const candidates = suggestRoots(ctx.settings().workspaceRoot, projects, userHome());
    return {
      best: candidates[0]?.path ?? null,
      total: projects.length,
      candidates: candidates.slice(0, 5),
    };
  });
  ctx.ipc.handle("projects.locate", (req) => {
    const paths = { ...ctx.settings().projectPaths };
    if (req.path === null) delete paths[req.id];
    else {
      if (!isDirectory(resolve(req.path)))
        throw new IpcFailure("no-folder", `${req.path} is not a folder`);
      paths[req.id] = resolve(req.path);
    }
    ctx.patchSettings({ projectPaths: paths });
    void ctx.projects.refresh(req.id);
    ctx.bus.emit("workspace.changed", {});
  });
  ctx.ipc.handle("setup.createBrain", (req) => ctx.onboarding.createBrain(req.folder, req.github));
  ctx.ipc.handle("onboarding.scan", async () => ({
    candidates: await ctx.onboarding.scan(),
    unmatchedNotes: ctx.onboarding.unmatchedNotes(),
    hubRepos: ctx.onboarding.hubRepos(),
  }));
  ctx.ipc.handle("onboarding.plan", (req) => ctx.onboarding.plan(req.items));
  ctx.ipc.handle("onboarding.add", async (req) => {
    const report = await ctx.onboarding.add(req.items);
    ctx.bus.emit("workspace.changed", {});
    void ctx.projects.refreshAll();
    return report;
  });
  ctx.ipc.handle("onboarding.remove", async (req) => {
    await ctx.onboarding.remove(req.id);
    ctx.bus.emit("workspace.changed", {});
  });
  ctx.ipc.handle("pointer.preview", (req) => ctx.onboarding.pointerPreview(req.id));
  ctx.ipc.handle("pointer.apply", (req) =>
    ctx.onboarding.pointerApply(req.ids, req.push, req.target),
  );
  ctx.ipc.handle("pointer.remove", (req) => ctx.onboarding.pointerRemove(req.ids));
  ctx.ipc.handle("setup.setProjectsRoot", (req) => {
    const path = resolve(req.path);
    if (!isDirectory(path)) throw new IpcFailure("no-projects-root", `${path} is not a folder`);
    ctx.patchSettings({ projectsRoot: path });
    void ctx.start().then(() => ctx.bus.emit("setup.changed", {}));
  });
  ctx.ipc.handle("setup.complete", () => {
    ctx.patchSettings({ welcomeDone: true });
    ctx.bus.emit("setup.changed", {});
  });
  ctx.ipc.handle("setup.inspect", (req) => inspectWorkspaceFolder(req.root));
  ctx.ipc.handle("setup.clone", (req) => cloneWorkspaceRepo(req.url, req.dest));
  ctx.ipc.handle("setup.apply", async (req) => {
    prepareWorkspace(req);
    // Reaching this with nothing recorded is a first run: the flow has begun and is not done.
    if (ctx.settings().welcomeDone === undefined) ctx.patchSettings({ welcomeDone: false });
    ctx.patchSettings({
      workspaceRoot: req.workspaceRoot,
      workspaceConfigPath: req.workspaceConfigPath,
      // The welcome flow picks the workspace first and the projects folder next; keep what is set.
      ...(req.projectsRoot ? { projectsRoot: req.projectsRoot } : {}),
    });
    await ctx.start();
    ctx.bus.emit("setup.changed", {});
    return workspaceView(ctx);
  });
  // Reading the inventory runs the tools' own list commands, so it is kept and refreshed behind the answer.
  const inventory = new BackgroundCache<string | undefined, Inventory[]>(
    (projectId) => {
      const project = projectId ? ctx.projects.find(projectId) : undefined;
      return readInventories(project ? ctx.projects.absPath(project) : undefined);
    },
    {
      keyOf: (id) => id ?? "",
      staleMs: 60_000,
      onChange: () => ctx.bus.emit("setup.changed", { from: "cache" }),
    },
  );
  ctx.ipc.handle("setup.inventory", (req) => inventory.get(req.projectId));
  ctx.ipc.handle("tools.list", (req) => ctx.toolConfig.list(req.projectId));
  ctx.ipc.handle("tools.preview", (req) => ctx.toolConfig.preview(req));
  ctx.ipc.handle("tools.apply", (req) => {
    ctx.toolConfig.apply(req.id);
    ctx.bus.emit("setup.changed", {});
  });

  const toolActions = {
    providers: ctx.providers,
    startCommand: (spec: { cmd: string; args: string[] }, title: string) =>
      ctx.sessions.startCommand(spec, title, userHome()),
  };
  ctx.ipc.handle("setup.login", (req) => loginTool(toolActions, req.id));
  ctx.ipc.handle("setup.install", (req) => installTool(toolActions, req.id));
  ctx.ipc.handle("setup.loginSession", (req) => loginSession(toolActions, req.id));
  ctx.ipc.handle("setup.installSession", (req) => installSession(toolActions, req.id));
  // Asking a provider runs its program, so the list is kept and refreshed behind the answer.
  const providerList = new BackgroundCache<null, ProviderStatus[]>(
    () =>
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
    {
      keyOf: () => "all",
      staleMs: 60_000,
      onChange: () => ctx.bus.emit("setup.changed", { from: "cache" }),
    },
  );
  ctx.ipc.handle("providers.list", () => providerList.get(null));
  // Fix in a session starts a chat with Claude Code when it is installed, else with the first agent that can chat.
  ctx.ipc.handle("fix.start", async (req) => {
    const list = await providerList.get(null);
    const chatty = list.filter((p) => p.installed && ctx.providers.get(p.id)?.chatCommand);
    const pick = chatty.find((p) => p.id === "claude-code") ?? chatty[0];
    if (!pick)
      throw new IpcFailure(
        "no-provider",
        "No agent is installed that can chat. Install Claude Code or Codex in Setup first",
      );
    return ctx.fix.start(req, pick.id);
  });
  ctx.ipc.handle("fix.list", () => ctx.fix.list());
  // The tools were looked at again (Check again, the timer): the providers are asked again too.
  ctx.bus.on("setup.changed", (event) => {
    if ((event.payload as { from?: string } | null)?.from !== "cache") providerList.invalidate();
  });
  void providerList.refresh(null).catch(() => undefined);
  void inventory.refresh(undefined).catch(() => undefined);
}

/** Agent sessions, their layout, hooks and end-of-session capture. */
function registerSessionHandlers(ctx: AppContext): void {
  ctx.ipc.handle("sessions.list", (req) => ctx.sessions.list(req));
  ctx.ipc.handle("sessions.setAutonomy", ({ id, level }) => ctx.sessions.setAutonomy(id, level));
  ctx.ipc.handle("sessions.start", (req) => {
    const row = ctx.sessions.start(req);
    // Codex has no command that lists models, so a model the owner typed is kept for the next time.
    if (req.model && row.provider === "codex") {
      rememberCodexModel(req.model);
      // The provider list shows the remembered models, so it is asked again.
      ctx.bus.emit("setup.changed", {});
    }
    return row;
  });
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
  ctx.ipc.handle("sessions.get", (req) => ctx.sessions.get(req.id));
  ctx.ipc.handle("sessions.pin", (req) => ctx.sessions.pin(req.id, req.pinned));
  ctx.ipc.handle("sessions.keep", (req) => ctx.sessions.keep(req.id));
  ctx.ipc.handle("layout.get", (req) => getLayout(ctx.db, req.key));
  ctx.ipc.handle("layout.set", (req) => setLayout(ctx.db, req.key, req.layout));
  ctx.ipc.handle("dock.get", (req) => getDock(ctx.db, req.key));
  ctx.ipc.handle("dock.set", (req) => setDock(ctx.db, req.key, req.json));
  ctx.ipc.handle("dock.list", (req) => listDock(ctx.db, req.prefix));
  ctx.ipc.handle("dock.remove", (req) => removeDock(ctx.db, req.key));
  ctx.ipc.handle("hooks.status", () => ctx.hooks.status());
  ctx.ipc.handle("hooks.preview", (req) => ctx.hooks.preview(req.target, req.action));
  ctx.ipc.handle("hooks.apply", async (req) => {
    const result = await ctx.hooks.apply(req.target, req.action);
    ctx.bus.emit("setup.changed", {});
    return result;
  });
  ctx.ipc.handle("sessions.wrapUp", async (req) => {
    const session = ctx.sessions.get(req.id);
    if (session.incognito) throw new IpcFailure("incognito", "Close the incognito chat to erase it.");
    await ctx.sessions.stop(req.id);
    if (ctx.sessions.get(req.id).running) throw new IpcFailure("busy", "The session is still stopping.");
    const result = await ctx.recorder.record(ctx.sessions.get(req.id));
    if (!result.error) ctx.sessions.markCaptured(req.id);
    ctx.sessions.archive(req.id);
    return result;
  });
}

/** Ask the brain, the audit, the morning brief and Explore. */
function registerBrainHandlers(ctx: AppContext): void {
  ctx.ipc.handle("requests.route", (req) => ctx.requestRouter.route(req.request, req.projectId));
  ctx.ipc.handle("recorder.digest", () => ctx.recorder.digest());
  ctx.ipc.handle("recorder.answer", (req) => ctx.recorder.answer(req.id, req.save));
  ctx.ipc.handle("recorder.undo", (req) => ctx.recorder.undo(req.id));
  ctx.ipc.handle("ask.start", (req) => ({ runId: ctx.ask.start(req.question, req.projectId) }));
  ctx.ipc.handle("ask.result", (req) => ctx.ask.result(req.runId));
  ctx.ipc.handle("ask.cancel", (req) => ctx.ask.cancel(req.runId));
  ctx.ipc.handle("vault.readFile", (req) => readVaultFile(ctx.settings().workspaceRoot, req.path));
  ctx.ipc.handle("vault.audit", () => readAudit(ctx.settings().workspaceRoot));
  ctx.ipc.handle("brief.latest", () => ctx.brief.latest());
  ctx.ipc.handle("brief.run", () => ctx.brief.run());
  ctx.ipc.handle("explore.start", (req) =>
    ctx.explore.start(req.providerId, req.incognito === true),
  );
  ctx.ipc.handle("explore.close", (req) => ctx.explore.close(req.id));
  ctx.ipc.handle("explore.keep", (req) => ctx.explore.keep(req.id));
  ctx.ipc.handle("explore.list", () => ctx.explore.list());
  ctx.ipc.handle("explore.plan", (req) => ctx.explore.plan(req));
  ctx.ipc.handle("explore.spawn", (req) => ctx.explore.spawn(req));
}

/** Branches, worktrees, diffs, commits and GitHub. */
/** The two helpers every git handler uses: a project's repo folder, and a refresh of its status. */
function gitHelpers(ctx: AppContext): {
  repoOf: (projectId: string) => string;
  changed: (projectId: string) => void;
} {
  return {
    repoOf: (projectId) => {
      const project = ctx.projects.find(projectId);
      if (!project) throw new IpcFailure("not-found", `No project with id ${projectId}`);
      return ctx.projects.absPath(project);
    },
    changed: (projectId) => void ctx.projects.refresh(projectId),
  };
}

function registerGitHandlers(ctx: AppContext): void {
  registerBranchHandlers(ctx);
  registerChangeHandlers(ctx);
}

/** Branches and worktrees. */
function registerBranchHandlers(ctx: AppContext): void {
  const { repoOf, changed } = gitHelpers(ctx);
  ctx.ipc.handle("git.graph", async (req) => {
    const repo = repoOf(req.projectId);
    const remotes = (await git(repo, ["remote"])).stdout
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    return readGraph(repo, req.limit ?? 300, remotes);
  });
  ctx.ipc.handle("branches.list", (req) => listBranches(repoOf(req.projectId)));
  ctx.ipc.handle("branches.switch", async (req) => {
    const result = await switchBranch(repoOf(req.projectId), req.name, {
      ...(req.stash ? { stash: true } : {}),
      ...(req.remote ? { remote: true } : {}),
      ...(req.detach ? { detach: true } : {}),
    });
    changed(req.projectId);
    return result;
  });
  ctx.ipc.handle("branches.create", async (req) => {
    await createBranch(repoOf(req.projectId), req.name, {
      ...(req.from ? { from: req.from } : {}),
      ...(req.switchTo ? { switchTo: true } : {}),
    });
    changed(req.projectId);
  });
  ctx.ipc.handle("git.show", (req) => showCommit(repoOf(req.projectId), req.hash));
  ctx.ipc.handle("branches.compare", (req) => compareBranches(repoOf(req.projectId), req.a, req.b));
  ctx.ipc.handle("branches.delete", async (req) => {
    await deleteBranch(repoOf(req.projectId), req.name);
    changed(req.projectId);
  });
  ctx.ipc.handle("branches.cleanMerged", async (req) => {
    const removed = await cleanMergedBranches(repoOf(req.projectId));
    changed(req.projectId);
    return removed;
  });
  ctx.ipc.handle("worktrees.list", async (req) => {
    const projects = (ctx.store.state.workspace?.projects ?? []).filter(
      (p) => !p.archived && (!req.projectId || p.id === req.projectId),
    );
    const rows = await Promise.all(
      projects.map(async (p) => {
        const path = ctx.projects.absPath(p);
        if (!existsSync(join(path, ".git"))) return [];
        try {
          return (await listWorktrees(path)).map((w) => ({
            ...w,
            projectId: p.id,
            projectName: p.name,
          }));
        } catch {
          return [];
        }
      }),
    );
    return rows.flat();
  });
  ctx.ipc.handle("worktrees.create", (req) =>
    createWorktree(repoOf(req.projectId), req.name, req.base),
  );
  ctx.ipc.handle("worktrees.remove", async (req) => {
    await removeWorktree(repoOf(req.projectId), req.path, {
      ...(req.confirmOther ? { confirmOther: true } : {}),
    });
    changed(req.projectId);
  });
  ctx.ipc.handle("worktrees.cleanMerged", async (req) => {
    const removed = await cleanMergedWorktrees(repoOf(req.projectId));
    changed(req.projectId);
    return removed;
  });
}

/** Diffs, review comments, commits, pushes and the GitHub overview. */
function registerChangeHandlers(ctx: AppContext): void {
  const { repoOf, changed } = gitHelpers(ctx);
  /** The repo folder, or one of its worktrees; anything else is refused. */
  const checkoutOf = async (projectId: string, dir?: string): Promise<string> => {
    const root = repoOf(projectId);
    if (!dir) return root;
    const norm = (p: string): string => normPath(resolve(p));
    if (norm(dir) === norm(root)) return root;
    const found = (await listWorktrees(root)).find((w) => norm(w.path) === norm(dir));
    if (!found) throw new IpcFailure("bad-path", "That folder is not a worktree of this project");
    return found.path;
  };
  ctx.ipc.handle("diff.get", async (req) =>
    getDiff(await checkoutOf(req.projectId, req.dir), req.mode, req.base),
  );
  ctx.ipc.handle("diff.sendComments", async (req) =>
    sendReviewToAgent(
      { sessions: ctx.sessions, workspace: () => ctx.store.state.workspace },
      req.projectId,
      await checkoutOf(req.projectId, req.dir),
      req.comments,
    ),
  );
  ctx.ipc.handle("git.status", async (req) => {
    const status = await readStatus(await checkoutOf(req.projectId, req.dir));
    if (!status.ok) throw new IpcFailure("git-failed", status.error);
    return status.status;
  });
  ctx.ipc.handle("commit.run", async (req) => {
    const dir = await checkoutOf(req.projectId, req.dir);
    const result = await commitFiles(dir, req.files, req.message, {
      ...(req.push ? { push: true } : {}),
    });
    changed(req.projectId);
    return result;
  });
  ctx.ipc.handle("git.push", async (req) => {
    const outcome = await pushCurrent(await checkoutOf(req.projectId, req.dir));
    changed(req.projectId);
    return outcome.ok ? { pushed: true } : { pushed: false, error: outcome.error };
  });
  // Pull requests and CI come from GitHub through gh, so they are kept and refreshed behind the answer.
  const overviews = new BackgroundCache<string, GithubOverview>(
    (projectId) => ctx.github.overview(projectId),
    {
      keyOf: (projectId) => projectId,
      staleMs: 60_000,
      onChange: (projectId) =>
        ctx.bus.emit("project.status", { projectId, from: "cache" }, projectId),
    },
  );
  ctx.ipc.handle("github.overview", (req) => overviews.get(req.projectId));
}

/** Edits to the workspace config, settings, automations and modules. */
function registerConfigHandlers(ctx: AppContext): void {
  ctx.ipc.handle("roles.save", (req) => ctx.editor.saveRole(req.id, req.role));
  ctx.ipc.handle("roles.remove", (req) => ctx.editor.removeRole(req.id));
  ctx.ipc.handle("profiles.save", (req) => ctx.editor.saveProfile(req.id, req.profile));
  ctx.ipc.handle("profiles.remove", (req) => ctx.editor.removeProfile(req.id));
  ctx.ipc.handle("pipelines.save", (req) => ctx.editor.savePipeline(req.id, req.pipeline));
  ctx.ipc.handle("pipelines.remove", (req) => ctx.editor.removePipeline(req.id));
  ctx.ipc.handle("projects.update", (req) => {
    const { id, ...patch } = req;
    return ctx.editor.updateProject(id, patch);
  });
  ctx.ipc.handle("roles.setOverride", (req) =>
    ctx.editor.setOverride(req.projectId, req.role, req.target),
  );
  ctx.ipc.handle("workflows.list", () => ctx.scheduler.list());
  ctx.ipc.handle("workflows.save", (req) => ctx.editor.saveWorkflow(req));
  ctx.ipc.handle("workflows.remove", (req) => ctx.editor.removeWorkflow(req.id));
  ctx.ipc.handle("workflows.results", () => ctx.workflowResults.list());
  ctx.ipc.handle("workflows.dismiss", (req) => ctx.workflowResults.dismiss(req.id));
  ctx.ipc.handle("workflows.runNow", async (req) => {
    await ctx.scheduler.fire(req.id);
  });
  const appSettings = (): AppSettings => {
    const s = ctx.settings();
    return {
      theme: s.theme,
      accent: s.accent,
      density: s.density,
      zoom: s.zoom,
      sidebarCollapsed: s.sidebarCollapsed,
      sidebarWidth: s.sidebarWidth,
      inspectorWidth: s.inspectorWidth,
      inspectorHidden: s.inspectorHidden,
      panes: s.panes,
      sessionMode: s.sessionMode,
      autonomy: s.autonomy === "full-auto" && !s.confirmedFullAuto ? "act-on-risk" : s.autonomy,
      confirmedFullAuto: s.confirmedFullAuto,
      briefEnabled: s.briefEnabled,
      briefModel: s.briefModel,
      briefTime: s.briefTime ?? ctx.store.state.workspace?.briefTime ?? "08:00",
      recorderEnabled: s.recorderEnabled,
      recorderModel: s.recorderModel,
      recorderIdleMinutes: s.recorderIdleMinutes,
      learningEnabled: s.learningEnabled,
      requestRouterEnabled: s.requestRouterEnabled,
      requestRouterModel: s.requestRouterModel,
      sessionIdleDays: s.sessionIdleDays,
      sessionsMulti: s.sessionsMulti,
      quietHours: s.quietHours ?? null,
      editorCommand: s.editorCommand,
      artVaultRoot: s.artVaultRoot,
    };
  };
  ctx.ipc.handle("settings.get", () => appSettings());
  ctx.ipc.handle("settings.set", (req) => {
    if (req.autonomy === "full-auto" && !req.confirmedFullAuto && !ctx.settings().confirmedFullAuto)
      throw new IpcFailure("confirm-autonomy", "Confirm full auto before using it.");
    queueMicrotask(() => ctx.bus.emit("settings.changed", {}));
    const { quietHours, panes, inspectorHidden, ...rest } = req;
    ctx.patchSettings({
      ...rest,
      ...(panes === undefined ? {} : { panes: { ...ctx.settings().panes, ...panes } }),
      ...(inspectorHidden === undefined
        ? {}
        : { inspectorHidden: { ...ctx.settings().inspectorHidden, ...inspectorHidden } }),
      ...(quietHours === undefined ? {} : { quietHours: quietHours ?? undefined }),
    });
    if (req.briefEnabled === false) void ctx.brief.run().catch(() => undefined);
    return appSettings();
  });
  ctx.ipc.handle("notifications.setRules", (req) => ctx.editor.setNotifications(req));
  ctx.ipc.handle("notifications.testPing", async () => {
    if (!ctx.store.state.workspace?.notifications.ntfyTopicUrl) {
      throw new IpcFailure("no-topic", "Set and save a ntfy topic URL first.");
    }
    try {
      await ctx.ntfy.post("Office test ping", "If you can read this, phone pings work.");
    } catch (err) {
      throw new IpcFailure("ping-failed", `The test ping failed: ${(err as Error).message}`);
    }
  });
  ctx.ipc.handle("modules.list", () => ctx.modules.list());
  ctx.ipc.handle("modules.setEnabled", (req) => ctx.modules.setEnabled(req.name, req.enabled));
}

/** The task board and the inbox. */
function registerTaskHandlers(ctx: AppContext): void {
  ctx.ipc.handle("chat.state", (req) => ctx.chat.state(req.id));
  ctx.ipc.handle("chat.history", (req) => ctx.chat.history(req.id));
  ctx.ipc.handle("chat.send", (req) =>
    ctx.chat.send(req.id, req.text, req.images ?? [], req.options),
  );
  ctx.ipc.handle("chat.stop", (req) => ctx.chat.stop(req.id));
  ctx.ipc.handle("chat.setOptions", (req) => ctx.chat.setOptions(req.id, req.options));
  ctx.ipc.handle("chat.files", (req) => ctx.chat.files(req.id, req.query));
  ctx.ipc.handle("chat.toTerminal", (req) => ctx.chat.toTerminal(req.id));
  ctx.ipc.handle("chat.toChat", (req) => ctx.chat.toChat(req.id));
  ctx.ipc.handle("permissions.list", () => ctx.permissions.list());
  ctx.ipc.handle("permissions.answer", (req) => {
    try {
      ctx.permissions.answer(req.id, req.allow, req.reason);
    } catch (err) {
      throw new IpcFailure("not-waiting", (err as Error).message);
    }
  });
  ctx.ipc.handle("tasks.list", (req) => ctx.tasks.list(req.projectId));
  ctx.ipc.handle("tasks.get", (req) => ctx.tasks.get(req.id));
  ctx.ipc.handle("tasks.create", (req) => ctx.tasks.create(req));
  ctx.ipc.handle("tasks.approve", (req) => ctx.tasks.approve(req.id));
  ctx.ipc.handle("tasks.reject", (req) => ctx.tasks.reject(req.id, req.comment));
  ctx.ipc.handle("tasks.record", (req) => ctx.tasks.record(req.id));
  ctx.ipc.handle("tasks.keep", (req) => ctx.tasks.keep(req.id, req.variant));
  ctx.ipc.handle("tasks.cancel", (req) => ctx.tasks.cancel(req.id));
  ctx.ipc.handle("tasks.retry", (req) => ctx.tasks.retry(req.id));
  ctx.ipc.handle("pending.list", () => ctx.pending.list());
  ctx.ipc.handle("pending.dismiss", (req) => ctx.pending.dismiss(req.key, req.fingerprint));
}

/** Vault notes: waiting items, todos, quick notes and health. */
function registerVaultHandlers(ctx: AppContext): void {
  ctx.ipc.handle("vault.openItems", (req) => ctx.vault.read(req.projectId));
  ctx.ipc.handle("vault.waiting", () => ctx.vault.allWaiting());
  ctx.ipc.handle("vault.tickWaiting", (req) => ctx.ops.tickWaiting(req.projectId, req.raw));
  ctx.ipc.handle("vault.tickTodo", (req) =>
    ctx.ops.tickTodo(req.projectId, req.line, req.text, req.checked),
  );
  ctx.ipc.handle("vault.addWaiting", (req) =>
    ctx.ops.addWaiting(req.projectId, req.text, req.source),
  );
  ctx.ipc.handle("vault.addNote", (req) => ctx.ops.addNote(req.projectId, req.text));
  // The last result of the background check, with its time: opening a screen never runs the checks.
  ctx.ipc.handle("vault.health", () => ctx.health.view());
  ctx.ipc.handle("vault.validate", async () => {
    await ctx.health.refresh();
    return ctx.health.view();
  });
  ctx.ipc.handle("vault.reindex", async () => {
    const count = await ctx.folderTools.reindex();
    await ctx.health.refresh();
    return { count };
  });
  ctx.ipc.handle("health.changes", (req) => ctx.healthActions.changes(req.folder));
  ctx.ipc.handle("health.commit", async (req) => ({
    hash: await ctx.healthActions.commit(req.folder, req.message),
  }));
  ctx.ipc.handle("health.discard", (req) => ctx.healthActions.discard(req.folder));
  ctx.ipc.handle("health.pull", (req) => ctx.healthActions.pull(req.folder));
  ctx.ipc.handle("health.push", (req) => ctx.healthActions.push(req.folder));
}
