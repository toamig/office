import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SyncReport, WorkspaceView } from "../shared/models";
import type { MachineSettings } from "../shared/types";
import { Bus } from "./core/bus";
import { openDb, type Db } from "./core/db";
import { IpcRegistry } from "./core/ipc";
import { NtfyChannel } from "./core/channels/ntfy";
import { ModuleManager } from "./core/modules";
import { Notifier } from "./core/notifier";
import { Scheduler } from "./core/scheduler";
import { RelayServer } from "./core/relay-server";
import {
  claudeSettingsPath,
  codexConfigPath,
  dataDir,
  dbPath,
  exploreDir,
  modulesDir,
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
import { writePermissionMcpConfig } from "./modules/runs/mcp-config";
import { PermissionBroker } from "./modules/runs/permissions";
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
  modules: ModuleManager;
  ntfy: NtfyChannel;
  relay: RelayServer;
  projects: ProjectService;
  github: GithubService;
  vault: VaultService;
  ops: VaultOps;
  /** Questions from headless builders waiting for the owner (plan 9.5). */
  permissions: PermissionBroker;
  /** Warnings shown in the health strip (failed pushes, validate errors). */
  warnings: Array<{ at: string; message: string }>;
  /** Sync all repos and raise notifications for what needs the owner. */
  sync: () => Promise<SyncReport>;
  syncProject: (id: string) => Promise<SyncReport>;
  /** Opens the workspace, starts watchers and timers. Call after settings change too. */
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** The machine settings, which the app replaces whenever they change; every service reads through it. */
interface SettingsBox {
  current: MachineSettings;
}

/** The pieces every other part is built on. */
interface Base {
  box: SettingsBox;
  bus: Bus;
  db: Db;
  store: WorkspaceStore;
  notifier: Notifier;
  ntfy: NtfyChannel;
}

/** The notes: the vault, its writer, and the projects that point into it. */
interface Notes {
  vault: VaultService;
  warnings: AppContext["warnings"];
  writer: VaultWriter;
  ops: VaultOps;
  projects: ProjectService;
}

function createBase(): Base {
  const box: SettingsBox = { current: loadSettings() };
  const bus = new Bus();
  const db = openDb(dbPath());
  const store = new WorkspaceStore();
  store.subscribe((state) => bus.emit("workspace.changed", { error: state.error }));
  const notifier = new Notifier({
    db,
    bus,
    workspace: () => store.state.workspace,
    quietHours: () => box.current.quietHours,
  });
  const ntfy = new NtfyChannel(() => store.state.workspace?.notifications.ntfyTopicUrl);
  notifier.addChannel(ntfy);
  return { box, bus, db, store, notifier, ntfy };
}

function createNotes({ box, bus, store, notifier }: Base): Notes {
  const vault = new VaultService({
    bus,
    workspace: () => store.state.workspace,
    workspaceRoot: () => box.current.workspaceRoot,
  });
  const warnings: AppContext["warnings"] = [];
  const writer = new VaultWriter({
    hubRoot: () =>
      store.state.workspace?.vault.kind === "brain-hub" ? box.current.workspaceRoot : null,
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
    projectsRoot: () => box.current.projectsRoot,
    waiting: (id) => vault.waitingCount(id),
  });
  return { vault, warnings, writer, ops, projects };
}

/** The absolute folder of a project, or undefined when it is unknown. */
const folderOf =
  (projects: ProjectService) =>
  (id: string): string | undefined => {
    const project = projects.find(id);
    return project ? projects.absPath(project) : undefined;
  };

/** Agents: providers, headless runs, interactive sessions, hooks, Ask, the brief and Explore. */
function createAgents(base: Base, notes: Notes, relayScript: string) {
  const { box, bus, db, store, notifier } = base;
  const { writer, projects } = notes;
  const providers = new ProviderRegistry();
  // The task engine is built later; the broker reaches it through this hook.
  const permissionHook: { onWaiting?: (runId: string, waiting: boolean) => void } = {};
  const broker = new PermissionBroker({
    db,
    bus,
    notifier,
    onWaiting: (runId, waiting) => permissionHook.onWaiting?.(runId, waiting),
  });
  const bridgeScript = join(dirname(relayScript), "office-permission-mcp.mjs");
  const runs = new RunService({
    db,
    bus,
    providers,
    runsDir: runsDir(),
    permissions: {
      broker,
      writeMcpConfig: (runId, dir) => writePermissionMcpConfig(dir, runId, bridgeScript),
    },
  });
  const ask = new AskService({
    runs,
    workspace: () => store.state.workspace,
    workspaceRoot: () => box.current.workspaceRoot,
  });
  const github = new GithubService({ projects, notifier });
  const brief = new BriefService({
    db,
    runs,
    notifier,
    workspace: () => store.state.workspace,
    projectsRoot: () => box.current.projectsRoot,
    workspaceRoot: () => box.current.workspaceRoot,
  });
  const sessions = new SessionService({
    db,
    bus,
    providers,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: folderOf(projects),
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
  const relay = new RelayServer(box.current.relay.token, {
    onClaude: (payload) => sessions.onClaudeHook(payload),
    onCodex: (payload) => sessions.onCodexEvent(payload),
    onPermission: (runId, body, signal) => broker.request(runId, body, signal),
  });
  const explore = new ExploreService({
    sessions,
    bus,
    exploreDir: exploreDir(),
    workspaceRoot: () => box.current.workspaceRoot,
    spawn: {
      workspace: () => store.state.workspace,
      workspaceRoot: () => box.current.workspaceRoot,
      projectsRoot: () => box.current.projectsRoot,
      workspaceFile: () => store.filePath,
      reloadWorkspace: () => void store.reload(),
      writer,
      sessions,
      runs,
    },
  });
  return {
    providers,
    runs,
    ask,
    github,
    brief,
    sessions,
    hooks,
    relay,
    explore,
    broker,
    permissionHook,
  };
}

type Agents = ReturnType<typeof createAgents>;

/** Orchestration: the workspace editor, the task engine, automations and optional modules. */
function createOrchestration(base: Base, notes: Notes, agents: Agents) {
  const { box, bus, db, store, notifier } = base;
  const { writer, ops, projects } = notes;
  const { providers, runs, sessions } = agents;
  const editor = new WorkspaceEditor({
    writer,
    workspaceFile: () => store.filePath,
    reload: () => void store.reload(),
    adopt: (workspace) => store.adopt(workspace),
  });
  const resolveRole = (roleId: string, projectId: string) =>
    sessions.resolveRole(roleId, projectId);
  const tasks = new TaskEngine({
    db,
    bus,
    runs,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: folderOf(projects),
    resolveRole,
    tasksDir: tasksDir(),
    artVaultRoot: () => box.current.artVaultRoot,
    recordNote: async (projectId, text) => {
      await ops.addTodo(projectId, text, undefined, "Implementation notes");
    },
  });
  const scheduler = new Scheduler({
    db,
    runs,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: folderOf(projects),
    resolveRole,
  });
  const modules = new ModuleManager({
    dir: () => modulesDir(),
    enabled: () => box.current.modules,
    setEnabled: (name, on) => {
      box.current = updateSettings({ modules: { ...box.current.modules, [name]: on } });
    },
    workspace: () => store.state.workspace,
    targets: {
      addChannel: (c) => notifier.addChannel(c),
      removeChannel: (id) => notifier.removeChannel(id),
      addProvider: (p) => providers.add(p),
      removeProvider: (id) => providers.remove(id),
    },
    log: (m) => console.log(m),
  });
  agents.permissionHook.onWaiting = (runId, waiting) => tasks.permissionWaiting(runId, waiting);
  return { editor, tasks, scheduler, modules };
}

type Orchestration = ReturnType<typeof createOrchestration>;

/** Starting and stopping everything that watches or ticks, and Sync all. */
function createLifecycle(
  base: Base,
  notes: Notes,
  agents: Agents,
  orch: Orchestration,
): Pick<AppContext, "sync" | "syncProject" | "start" | "stop"> {
  const { box, bus, store, notifier } = base;
  const { vault, projects } = notes;
  const { github, brief, sessions, relay } = agents;
  const { scheduler, modules } = orch;
  const waiting = new WaitingWatcher(vault, notifier, () => store.state.workspace?.projects ?? []);
  bus.on("vault.changed", () => waiting.check());
  bus.on("workspace.changed", () => {
    void vault.watch();
    projects.startAuto();
  });

  const syncDeps: SyncAllDeps = {
    workspace: () => store.state.workspace,
    projectsRoot: () => box.current.projectsRoot,
    workspaceRoot: () => box.current.workspaceRoot,
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
    await modules.loadEnabled();
    const port = await relay.start(box.current.relay.port);
    if (port !== box.current.relay.port)
      box.current = updateSettings({ relay: { ...box.current.relay, port } });
    if (!isConfigured(box.current)) return;
    await store.open(box.current.workspaceRoot, box.current.workspaceConfigPath);
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
    sync: () => syncAll(syncDeps),
    syncProject: (id) => syncProject(syncDeps, id),
    start,
    stop,
  };
}

export async function createContext(
  checkResponses: boolean,
  relayScript: string,
): Promise<AppContext> {
  mkdirSync(dataDir(), { recursive: true });
  const base = createBase();
  const notes = createNotes(base);
  const agents = createAgents(base, notes, relayScript);
  const orch = createOrchestration(base, notes, agents);
  const { box, store, db, bus, notifier, ntfy } = base;
  return {
    settings: () => box.current,
    patchSettings: (patch) => (box.current = updateSettings(patch)),
    store,
    db,
    bus,
    ipc: new IpcRegistry(checkResponses),
    notifier,
    ntfy,
    ...agents,
    permissions: agents.broker,
    ...orch,
    projects: notes.projects,
    vault: notes.vault,
    ops: notes.ops,
    warnings: notes.warnings,
    ...createLifecycle(base, notes, agents, orch),
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
