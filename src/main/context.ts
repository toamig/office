import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SyncReport, WorkspaceView } from "../shared/models";
import type { MachineSettings } from "../shared/types";
import { Bus } from "./core/bus";
import { openDb, type Db } from "./core/db";
import { IpcRegistry } from "./core/ipc";
import { Notifier } from "./core/notifier";
import { Scheduler } from "./core/scheduler";
import { RelayServer } from "./core/relay-server";
import {
  claudeSettingsPath,
  codexConfigPath,
  dataDir,
  dbPath,
  exploreDir,
  runsDir,
  sessionsDir,
  tasksDir,
  userHome,
} from "./core/paths";
import { isConfigured, loadSettings, updateSettings } from "./core/settings";
import { WorkspaceStore } from "./core/workspace";
import { GithubService } from "./modules/github/gh";
import { ProjectService } from "./modules/git/service";
import { ProviderRegistry } from "./modules/providers/registry";
import { syncAll, syncProject, type SyncAllDeps } from "./modules/git/syncall";
import { notifyFromSyncReport, notifyFromWarning, WaitingWatcher } from "./modules/notify/sources";
import { TaskEngine } from "./modules/tasks/engine";
import { WorkspaceEditor } from "./modules/tasks/editor";
import { HooksManager } from "./modules/setup/install-hooks";
import { BriefService } from "./modules/brief/brief";
import { ExploreService } from "./modules/explore/explore";
import { AskService } from "./modules/ask/ask";
import { RunService } from "./modules/runs/service";
import { SessionService } from "./modules/sessions/service";
import { VaultOps } from "./modules/vault/ops";
import { VaultService } from "./modules/vault/service";
import { VaultWriter } from "./modules/vault/writer";

/** Everything the main process shares: settings, workspace, database, bus and the IPC registry. */
export interface AppContext {
  settings: () => MachineSettings;
  patchSettings: (patch: Partial<MachineSettings>) => MachineSettings;
  store: WorkspaceStore;
  db: Db;
  bus: Bus;
  ipc: IpcRegistry;
  notifier: Notifier;
  providers: ProviderRegistry;
  sessions: SessionService;
  runs: RunService;
  ask: AskService;
  explore: ExploreService;
  brief: BriefService;
  hooks: HooksManager;
  editor: WorkspaceEditor;
  tasks: TaskEngine;
  scheduler: Scheduler;
  relay: RelayServer;
  projects: ProjectService;
  github: GithubService;
  vault: VaultService;
  ops: VaultOps;
  /** Warnings shown in the health strip (failed pushes, validate errors). */
  warnings: Array<{ at: string; message: string }>;
  /** Sync all repos and raise notifications for what needs the owner. */
  sync: () => Promise<SyncReport>;
  syncProject: (id: string) => Promise<SyncReport>;
  /** Opens the workspace, starts watchers and timers. Call after settings change too. */
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function createContext(
  checkResponses: boolean,
  relayScript: string,
): Promise<AppContext> {
  mkdirSync(dataDir(), { recursive: true });
  let current = loadSettings();
  const bus = new Bus();
  const db = openDb(dbPath());
  const store = new WorkspaceStore();
  store.subscribe((state) => bus.emit("workspace.changed", { error: state.error }));

  const notifier = new Notifier({
    db,
    bus,
    workspace: () => store.state.workspace,
    quietHours: () => current.quietHours,
  });
  const vault = new VaultService({
    bus,
    workspace: () => store.state.workspace,
    workspaceRoot: () => current.workspaceRoot,
  });
  const warnings: AppContext["warnings"] = [];
  const writer = new VaultWriter({
    hubRoot: () =>
      store.state.workspace?.vault.kind === "brain-hub" ? current.workspaceRoot : null,
    onWarning: (warning) => {
      warnings.unshift({ at: new Date().toISOString(), message: warning.message });
      warnings.length = Math.min(warnings.length, 20);
      notifyFromWarning(notifier, warning);
    },
  });
  const ops = new VaultOps({ vault, writer, workspace: () => store.state.workspace });
  const projects = new ProjectService({
    bus,
    projects: () => store.state.workspace?.projects ?? [],
    projectsRoot: () => current.projectsRoot,
    waiting: (id) => vault.waitingCount(id),
  });
  const providers = new ProviderRegistry();
  const runs = new RunService({ db, bus, providers, runsDir: runsDir() });
  const ask = new AskService({
    runs,
    workspace: () => store.state.workspace,
    workspaceRoot: () => current.workspaceRoot,
  });
  const github = new GithubService({ projects, notifier });
  const brief = new BriefService({
    db,
    runs,
    notifier,
    workspace: () => store.state.workspace,
    projectsRoot: () => current.projectsRoot,
    workspaceRoot: () => current.workspaceRoot,
  });
  const sessions = new SessionService({
    db,
    bus,
    providers,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: (id) => {
      const project = projects.find(id);
      return project ? projects.absPath(project) : undefined;
    },
    logsDir: sessionsDir(),
  });
  providers.setTerminalOpener((spec, title) => {
    sessions.startCommand(spec, title, userHome());
  });
  const hooks = new HooksManager(() => ({
    claudeSettings: claudeSettingsPath(),
    codexConfig: codexConfigPath(),
    recordPath: join(dataDir(), "hooks-install.json"),
    relayScript,
  }));
  const relay = new RelayServer(current.relay.token, {
    onClaude: (payload) => sessions.onClaudeHook(payload),
    onCodex: (payload) => sessions.onCodexEvent(payload),
  });
  const explore = new ExploreService({
    sessions,
    bus,
    exploreDir: exploreDir(),
    workspaceRoot: () => current.workspaceRoot,
    spawn: {
      workspace: () => store.state.workspace,
      workspaceRoot: () => current.workspaceRoot,
      projectsRoot: () => current.projectsRoot,
      workspaceFile: () => store.filePath,
      reloadWorkspace: () => void store.reload(),
      writer,
      sessions,
      runs,
    },
  });
  const editor = new WorkspaceEditor({
    writer,
    workspaceFile: () => store.filePath,
    reload: () => void store.reload(),
  });
  const tasks = new TaskEngine({
    db,
    bus,
    runs,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: (id) => {
      const project = projects.find(id);
      return project ? projects.absPath(project) : undefined;
    },
    resolveRole: (roleId, projectId) => sessions.resolveRole(roleId, projectId),
    tasksDir: tasksDir(),
    recordNote: async (projectId, text) => {
      await ops.addTodo(projectId, text, undefined, "Implementation notes");
    },
  });
  const scheduler = new Scheduler({
    db,
    runs,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: (id) => {
      const project = projects.find(id);
      return project ? projects.absPath(project) : undefined;
    },
    resolveRole: (roleId, projectId) => sessions.resolveRole(roleId, projectId),
  });
  const waiting = new WaitingWatcher(vault, notifier, () => store.state.workspace?.projects ?? []);
  bus.on("vault.changed", () => waiting.check());
  bus.on("workspace.changed", () => {
    void vault.watch();
    projects.startAuto();
  });

  const syncDeps: SyncAllDeps = {
    workspace: () => store.state.workspace,
    projectsRoot: () => current.projectsRoot,
    workspaceRoot: () => current.workspaceRoot,
    onRepoDone: (id) => void projects.refresh(id),
    onReport: (report) => notifyFromSyncReport(notifier, report),
  };

  let archiveTimer: NodeJS.Timeout | undefined;
  let briefTimer: NodeJS.Timeout | undefined;
  const stop = async (): Promise<void> => {
    clearInterval(archiveTimer);
    clearInterval(briefTimer);
    github.stop();
    scheduler.stop();
    sessions.stopTimer();
    await relay.stop();
    projects.stopAuto();
    await vault.unwatch();
    await store.close();
  };
  const start = async (): Promise<void> => {
    await stop();
    const port = await relay.start(current.relay.port);
    if (port !== current.relay.port)
      current = updateSettings({ relay: { ...current.relay, port } });
    if (!isConfigured(current)) return;
    await store.open(current.workspaceRoot, current.workspaceConfigPath);
    waiting.prime();
    await vault.watch();
    projects.startAuto();
    github.start();
    scheduler.start();
    void projects.refreshAll();
    sessions.startTimer();
    const archive = (): void => {
      sessions.autoArchive(store.state.workspace?.archiveAfterDays ?? 7);
    };
    archive();
    archiveTimer = setInterval(archive, 3_600_000);
    const due = (): void => void brief.runIfDue().catch(() => undefined);
    due();
    briefTimer = setInterval(due, 60_000);
  };

  return {
    settings: () => current,
    patchSettings: (patch) => (current = updateSettings(patch)),
    store,
    db,
    bus,
    ipc: new IpcRegistry(checkResponses),
    notifier,
    providers,
    sessions,
    runs,
    ask,
    explore,
    brief,
    hooks,
    editor,
    tasks,
    scheduler,
    relay,
    projects,
    github,
    vault,
    ops,
    warnings,
    sync: () => syncAll(syncDeps),
    syncProject: (id) => syncProject(syncDeps, id),
    start,
    stop,
  };
}

export function workspaceView(ctx: AppContext): WorkspaceView {
  const s = ctx.settings();
  const state = ctx.store.state;
  return {
    configured: isConfigured(s),
    workspaceRoot: s.workspaceRoot,
    workspaceConfigPath: s.workspaceConfigPath,
    projectsRoot: s.projectsRoot,
    editorCommand: s.editorCommand,
    workspace: state.workspace,
    error: state.error,
  };
}
