import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SetupState, SyncReport, WorkspaceView } from "../shared/models";
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
import { PendingService } from "./modules/pending/service";
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
import { ChatService } from "./modules/chat/service";
import { RunService } from "./modules/runs/service";
import { writePermissionMcpConfig } from "./modules/runs/mcp-config";
import { PermissionBroker } from "./modules/runs/permissions";
import { SessionService } from "./modules/sessions/service";
import { VaultOps } from "./modules/vault/ops";
import { HealthService } from "./modules/vault/health-service";
import { OnboardingService } from "./modules/onboarding/service";
import { readHubStatus, runValidate } from "./modules/vault/health";
import { detectTools } from "./modules/setup/detect";
import { ToolsMonitor } from "./modules/setup/tools-monitor";
import { computeSetupState } from "./modules/setup/state";
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
  /** What waits on the owner, derived from live state. */
  pending: PendingService;
  /** Agent conversations shown as chats (M6.5). */
  chat: ChatService;
  /** Warnings shown in the health strip (failed pushes, validate errors). */
  warnings: Array<{ at: string; message: string }>;
  /** Starting a brain, adding projects, the agent pointer (M9). */
  onboarding: OnboardingService;
  /** The brain's health, refreshed in the background; reads return the last result. */
  health: HealthService;
  /** The last look at the command-line tools, refreshed in the background. */
  toolsMonitor: ToolsMonitor;
  /** Where the welcome flow stands. */
  setupState: () => SetupState;
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
  health: HealthService;
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
      bus.emit("vault.health", {});
    },
  });
  const ops = new VaultOps({ vault, writer, workspace: () => store.state.workspace });
  const projects = new ProjectService({
    bus,
    projects: () => store.state.workspace?.projects ?? [],
    projectsRoot: () => box.current.projectsRoot,
    projectPaths: () => box.current.projectPaths,
    waiting: (id) => vault.waitingCount(id),
  });
  const health = new HealthService({
    root: () => box.current.workspaceRoot,
    kind: () => store.state.workspace?.vault.kind,
    warnings: () => warnings,
    validate: runValidate,
    repos: readHubStatus,
    onChange: () => bus.emit("vault.health", {}),
  });
  return { vault, warnings, health, writer, ops, projects };
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
  const permissionHook: { listeners: Array<(runId: string, waiting: boolean) => void> } = {
    listeners: [],
  };
  const broker = new PermissionBroker({
    db,
    bus,
    notifier,
    onWaiting: (runId, waiting) => permissionHook.listeners.forEach((fn) => fn(runId, waiting)),
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
    projectPaths: () => box.current.projectPaths,
    workspaceRoot: () => box.current.workspaceRoot,
    written: () => bus.emit("brief.changed", {}),
  });
  const sessions = new SessionService({
    db,
    bus,
    providers,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: folderOf(projects),
    logsDir: sessionsDir(),
    defaultMode: () => box.current.sessionMode,
    idleDays: () => box.current.sessionIdleDays,
  });
  const chat = new ChatService({
    bus,
    providers,
    sessions,
    chatsDir: join(dataDir(), "chats"),
    broker,
    writeMcpConfig: (id, dir) => writePermissionMcpConfig(dir, id, bridgeScript),
  });
  sessions.chat = {
    send: (id, text) => chat.send(id, text),
    configure: (id, extra) => chat.configure(id, extra),
    stop: (id) => chat.stop(id),
    running: (id) => chat.running(id),
    keep: (id) => chat.keep(id),
    forget: (id) => chat.forget(id),
    history: (id) => chat.history(id),
  };
  permissionHook.listeners.push((runId, waiting) => chat.permissionWaiting(runId, waiting));
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
    chat,
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
    migrated: (info) => bus.emit("profiles.migrated", info),
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
  agents.permissionHook.listeners.push((runId, waiting) => tasks.permissionWaiting(runId, waiting));
  return { editor, tasks, scheduler, modules };
}

type Orchestration = ReturnType<typeof createOrchestration>;

/** Starting and stopping everything that watches or ticks, and Sync all. */
function createLifecycle(
  base: Base,
  notes: Notes,
  agents: Agents,
  orch: Orchestration,
  toolsMonitor: ToolsMonitor,
  pending: PendingService,
): Pick<AppContext, "sync" | "syncProject" | "start" | "stop"> {
  const { box, bus, store, notifier } = base;
  const { vault, projects, health } = notes;
  const { github, brief, sessions, relay, explore } = agents;
  const { scheduler, modules } = orch;
  const waiting = new WaitingWatcher(vault, notifier, () => store.state.workspace?.projects ?? []);
  bus.on("vault.changed", () => {
    waiting.check();
    // The brain's validation takes seconds: it runs once things have been quiet, never per change.
    health.schedule();
  });
  bus.on("workspace.changed", () => {
    void vault.watch();
    projects.startAuto();
  });

  const syncDeps: SyncAllDeps = {
    workspace: () => store.state.workspace,
    projectsRoot: () => box.current.projectsRoot,
    projectPaths: () => box.current.projectPaths,
    workspaceRoot: () => box.current.workspaceRoot,
    onRepoDone: (id) => void projects.refresh(id),
    onReport: (report) => {
      notifyFromSyncReport(notifier, report);
      pending.onSyncReport(report);
    },
  };

  let toolsStarted = false;
  let archiveTimer: NodeJS.Timeout | undefined;
  let briefTimer: NodeJS.Timeout | undefined;
  const stop = async (): Promise<void> => {
    clearInterval(archiveTimer);
    clearInterval(briefTimer);
    health.stop();
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
    // An incognito chat does not outlive the run that opened it, even when that run was killed.
    explore.clearLeftovers();
    const port = await relay.start(box.current.relay.port);
    if (port !== box.current.relay.port)
      box.current = updateSettings({ relay: { ...box.current.relay, port } });
    if (!toolsStarted) {
      toolsStarted = true;
      toolsMonitor.start();
    }
    if (!isConfigured(box.current)) return;
    await store.open(box.current.workspaceRoot, box.current.workspaceConfigPath);
    waiting.prime();
    await vault.watch();
    health.start();
    projects.startAuto();
    github.start();
    scheduler.start();
    void projects.refreshAll();
    sessions.startTimer();
    const archive = (): void => {
      sessions.autoArchive(store.state.workspace?.archiveAfterDays ?? 7);
      // Saved chats that nobody has used for the idle time archive themselves, unless pinned.
      sessions.archiveIdleChats(box.current.sessionIdleDays);
    };
    archive();
    archiveTimer = setInterval(archive, 3_600_000);
    const due = (): void => void brief.runIfDue().catch(() => undefined);
    due();
    briefTimer = setInterval(due, 60_000);
  };
  return {
    sync: async () => {
      const report = await syncAll(syncDeps);
      void health.refresh();
      return report;
    },
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
  const onboarding = new OnboardingService({
    workspace: () => store.state.workspace,
    workspaceRoot: () => box.current.workspaceRoot,
    projectsRoot: () => box.current.projectsRoot,
    projectPaths: () => box.current.projectPaths,
    workspaceFile: () => store.filePath,
    reloadWorkspace: () => void store.reload(),
    writer: notes.writer,
    // The template ships beside the relay script (resources/ in development, the install's resources folder when packaged).
    templateDir: () => join(dirname(relayScript), "..", "brain-template"),
    notesRepo: (name, domain, stack) => agents.explore.notesRepo(name, domain, stack),
  });
  const toolsMonitor = new ToolsMonitor(detectTools, () => bus.emit("setup.changed", {}));
  const setupState = (tools: ToolsMonitor["current"] = toolsMonitor.current): SetupState => {
    const s = box.current;
    const hooks = agents.hooks.status();
    return computeSetupState({
      settings: s,
      workspaceError: store.state.error,
      tools,
      hooksInstalled: hooks.claude.installed || hooks.codex.installed,
      projectCount: store.state.workspace?.projects.length ?? 0,
    });
  };
  // A machine that was set up before the welcome flow existed has nothing to be welcomed to.
  if (box.current.welcomeDone === undefined) {
    const steps = setupState(null).steps;
    if (steps[0]!.met && steps[1]!.met) box.current = updateSettings({ welcomeDone: true });
  }
  const pending = new PendingService({
    db,
    bus,
    sources: {
      sessions: () => agents.sessions.list(),
      tasks: () => orch.tasks.list(),
      permissions: () => agents.broker.list(),
      projects: () => notes.projects.list(),
      waiting: () => notes.vault.allWaiting(),
      github: () => agents.github.pendingState(),
    },
  });
  agents.github.onChange = () => pending.changed();
  return {
    settings: () => box.current,
    patchSettings: (patch) => (box.current = updateSettings(patch)),
    store,
    db,
    bus,
    ipc: new IpcRegistry(checkResponses, (channel, ms) => {
      // Development and test runs log every call's duration, so a slow handler shows up where it is called.
      if ((checkResponses || process.env["OFFICE_E2E"] === "1") && !process.env["OFFICE_QUIET_IPC"])
        console.log(`[ipc] ${channel} ${ms.toFixed(1)} ms`);
    }),
    notifier,
    ntfy,
    ...agents,
    permissions: agents.broker,
    pending,
    ...orch,
    projects: notes.projects,
    vault: notes.vault,
    ops: notes.ops,
    warnings: notes.warnings,
    health: notes.health,
    onboarding,
    toolsMonitor,
    setupState,
    ...createLifecycle(base, notes, agents, orch, toolsMonitor, pending),
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
