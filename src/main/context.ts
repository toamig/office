import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SetupState, SyncReport, WorkspaceView } from "../shared/models";
import type { MachineSettings } from "../shared/types";
import { Bus } from "./core/bus";
import { openDb, type Db } from "./core/db";
import { resolveTool, run } from "./core/exec";
import { IpcRegistry } from "./core/ipc";
import { NtfyChannel } from "./core/channels/ntfy";
import { ModuleManager } from "./core/modules";
import { Notifier } from "./core/notifier";
import { cheapestModel, Scheduler } from "./core/scheduler";
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
import { FixService } from "./modules/pending/fix";
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
import { RequestRouter } from "./modules/ask/router";
import { ChatService } from "./modules/chat/service";
import { OfficeTools } from "./modules/chat/office-tools";
import { RunService } from "./modules/runs/service";
import { WorkflowResults } from "./modules/runs/workflow-results";
import { ClaudeTokenStore, type SecretStorage } from "./modules/providers/claude-auth";
import { ClaudeCodeProvider } from "./modules/providers/claude-code";
import { ClaudeSignIn } from "./modules/setup/claude-sign-in";
import { workflowDiscussion } from "./modules/runs/workflow-discussion";
import { ConversationBridge, writePermissionMcpConfig } from "./modules/runs/mcp-config";
import { PermissionBroker } from "./modules/runs/permissions";
import { SessionService } from "./modules/sessions/service";
import { VaultOps } from "./modules/vault/ops";
import { HealthActions } from "./modules/vault/health-actions";
import { HealthService } from "./modules/vault/health-service";
import { OnboardingService } from "./modules/onboarding/service";
import { readHubStatus, runValidate } from "./modules/vault/health";
import { commitStarterFiles, detectRuleDomain, StarterPack } from "./modules/vault/starter-pack";
import { notesPath, readText } from "./modules/vault/scope";
import { frontmatterValue } from "./modules/notes/notes";
import { detectTools } from "./modules/setup/detect";
import { ToolsMonitor } from "./modules/setup/tools-monitor";
import { ToolConfigService } from "./modules/setup/tool-config";
import { computeSetupState } from "./modules/setup/state";
import { VaultService } from "./modules/vault/service";
import { VaultWriter } from "./modules/vault/writer";
import { brainScope } from "./modules/vault/scope";
import { Recorder } from "./modules/vault/recorder";
import { FolderTools } from "./modules/vault/folder-tools";

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
  requestRouter: RequestRouter;
  explore: ExploreService;
  brief: BriefService;
  recorder: Recorder;
  hooks: HooksManager;
  editor: WorkspaceEditor;
  tasks: TaskEngine;
  scheduler: Scheduler;
  workflowResults: WorkflowResults;
  starterPack: () => StarterPack;
  changeStarterRules: (work: (pack: StarterPack) => string[], message: string, digest?: boolean) => Promise<void>;
  starterDomains: () => string[];
  claudeSignIn: ClaudeSignIn;
  claudeEnv: () => Record<string, string>;
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
  /** Fix in a session: a chat started for a problem, and which problems have one. */
  fix: FixService;
  /** Agent conversations shown as chats (M6.5). */
  chat: ChatService;
  officeTools: OfficeTools;
  /** Warnings shown in the health strip (failed pushes, validate errors). */
  warnings: Array<{ at: string; message: string }>;
  /** Starting a brain, adding projects, the agent pointer (M9). */
  onboarding: OnboardingService;
  /** The brain's health, refreshed in the background; reads return the last result. */
  health: HealthService;
  /** The fixes the brain's health offers: commit, discard, pull and push. */
  healthActions: HealthActions;
  folderTools: FolderTools;
  /** The last look at the command-line tools, refreshed in the background. */
  toolsMonitor: ToolsMonitor;
  toolConfig: ToolConfigService;
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
  healthActions: HealthActions;
  folderTools: FolderTools;
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
  const folderTools = new FolderTools({
    root: () => box.current.workspaceRoot,
    enabled: () => store.state.workspace?.vault.kind === "folder",
    folders: () => store.state.workspace?.projects.flatMap((p) => p.vault ? [p.vault] : []) ?? [],
    writer,
  });
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
    validate: (root) => runValidate(root, folderTools.enabled() ? () => folderTools.validate(root) : undefined),
    repos: readHubStatus,
    onChange: () => bus.emit("vault.health", {}),
  });
  const healthActions = new HealthActions({
    root: () => box.current.workspaceRoot,
    changed: () => void health.refresh(),
  });
  return { vault, warnings, health, healthActions, folderTools, writer, ops, projects };
}

/** The absolute folder of a project, or undefined when it is unknown. */
const folderOf =
  (projects: ProjectService) =>
  (id: string): string | undefined => {
    const project = projects.find(id);
    return project ? projects.absPath(project) : undefined;
  };

const cheapestProvider = () => resolveTool("claude") ? "claude-code"
  : resolveTool("fake-claude") ? "fake"
  : resolveTool("codex") ? "codex" : "claude-code";

/** Agents: providers, headless runs, interactive sessions, hooks, Ask, the brief and Explore. */
function createAgents(base: Base, notes: Notes, relayScript: string, tokens: ClaudeTokenStore) {
  const { box, bus, db, store, notifier } = base;
  const { writer, projects } = notes;
  const providers = new ProviderRegistry(tokens);
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
  const conversationBridge = new ConversationBridge(bridgeScript, () => box.current.workspaceRoot);
  const runs = new RunService({
    db,
    bus,
    providers,
    runsDir: runsDir(),
    fullAutoConfirmed: () => box.current.confirmedFullAuto,
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
    settings: () => ({ enabled: box.current.briefEnabled, model: box.current.briefModel, time: box.current.briefTime }),
    defaultProvider: cheapestProvider,
    written: () => {
      recorder.markBrief();
      bus.emit("brief.changed", {});
    },
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
    autonomySettings: () => box.current,
    brainScope: (id) => brainScope(store.state.workspace, box.current.workspaceRoot, id),
    officeMcp: (id) => conversationBridge.config(id),
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
  const recorder = new Recorder({
    db,
    writer,
    workspace: () => store.state.workspace,
    root: () => box.current.workspaceRoot,
    projectFolder: folderOf(projects),
    sessions: () => sessions.list({ chats: true, includeArchived: true }),
    chatsDir: join(dataDir(), "chats"),
    terminalsDir: sessionsDir(),
    settings: () => ({
      enabled: box.current.recorderEnabled,
      learning: box.current.learningEnabled,
      idleMinutes: box.current.recorderIdleMinutes,
    }),
    afterSave: async (root) => {
      if (root !== box.current.workspaceRoot || !notes.folderTools.enabled()) return;
      try {
        await notes.folderTools.reindex();
      } catch (error) {
        notes.warnings.unshift({ at: new Date().toISOString(), message: (error as Error).message });
        notes.warnings.length = Math.min(notes.warnings.length, 20);
      }
      await notes.health.refresh();
    },
    complete: async (session, prompt) => {
      const providerId = session.provider;
      const handle = runs.start({
        kind: "recorder", providerId, cwd: dataDir(), prompt, tools: "",
        ...(session.projectId ? { projectId: session.projectId } : {}),
        role: {
          provider: providerId,
          model: box.current.recorderModel || cheapestModel(providerId),
          instructions: "", readOnly: true, allowedCommands: [],
        },
      });
      const result = await handle.result;
      if (!result.ok) throw new Error(result.error || "The recorder run failed.");
      return result.resultText;
    },
    changed: () => {
      vaultChanged();
      bus.emit("recorder.changed", {});
    },
  });
  const vaultChanged = (): void => {
    notes.vault.invalidate();
    bus.emit("vault.changed", {});
  };
  sessions.chat = {
    send: (id, text, images, options, brief) => chat.send(id, text, images, options, brief),
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
    recorder,
    sessions,
    hooks,
    relay,
    explore,
    broker,
    permissionHook,
    chat,
    conversationBridge,
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
  const workflowResults = new WorkflowResults({
    db,
    root: () => box.current.workspaceRoot,
    changed: () => bus.emit("workflow.changed", {}),
    saveNote: (projectId, text) => agents.recorder.saveNote(projectId, text),
    chatAvailable: (id) => {
      const session = agents.sessions.find(id);
      return !!session && !session.archivedAt && (!session.brainRoot || session.brainRoot === box.current.workspaceRoot);
    },
    startDiscussion: (item, sourceProject) => {
      const { projectId, prompt } = workflowDiscussion(item, store.state.workspace, box.current.workspaceRoot, sourceProject);
      const session = agents.explore.start(cheapestProvider(), false, projectId);
      agents.sessions.rename(session.id, item.title);
      try {
        agents.chat.send(session.id, prompt, [], undefined, {
          title: item.title,
          where: projectId ? store.state.workspace?.projects.find((project) => project.id === projectId)?.name ?? projectId : item.workflowName,
          done: "Decide whether to pursue the suggestion and agree on a first step.",
        });
      } catch (error) {
        agents.sessions.archive(session.id);
        throw error;
      }
      return session.id;
    },
  });
  const scheduler = new Scheduler({
    db,
    runs,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: folderOf(projects),
    root: () => box.current.workspaceRoot,
    neutralFolder: dataDir,
    defaultProvider: cheapestProvider,
    output: (root, workflow, result) => workflowResults.save(root, workflow, result),
    changed: () => bus.emit("workflow.changed", {}),
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
  return { editor, tasks, scheduler, modules, workflowResults };
}

type Orchestration = ReturnType<typeof createOrchestration>;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/** The words and tool output at the end of a session: a chat's last lines, a terminal's last screen. */
function sessionTail(agents: Agents, id: string): string {
  const session = agents.sessions.find(id);
  if (!session) return "";
  if (session.mode === "chat") {
    const lines = agents.chat.history(id).slice(-40);
    const parts: string[] = [];
    for (const { event } of lines) {
      if (event.t === "assistant" && event.text.trim()) parts.push(event.text.trim());
      else if (event.t === "tool-result" && event.output.trim())
        parts.push(`${event.isError ? "[error] " : ""}${event.output.trim()}`);
      else if (event.t === "error") parts.push(`[error] ${event.message}`);
    }
    return parts.join("\n").trim();
  }
  return agents.sessions.history(id).data.replace(ANSI, "").replace(/\r/g, "").trim();
}

/** Fix in a session: what it reads from the rest of the app, and how it starts the chat. */
function createFix(
  base: Base,
  notes: Notes,
  agents: Agents,
  orch: Orchestration,
  pending: PendingService,
): FixService {
  const { box, bus, db } = base;
  const { projects } = notes;
  const dirOf = folderOf(projects);
  return new FixService({
    db,
    bus,
    findPending: (key) => pending.list().find((i) => i.key === key),
    failedRun: (projectId) =>
      agents.github.pendingState().find((g) => g.projectId === projectId)?.ci ?? null,
    projectDir: dirOf,
    projectName: (id) => projects.find(id)?.name ?? id,
    workspaceRoot: () => box.current.workspaceRoot,
    session: (id) => agents.sessions.find(id),
    sessionTail: (id) => sessionTail(agents, id),
    task: (id) => {
      const task = orch.tasks.list().find((t) => t.id === id);
      if (!task) return undefined;
      const stage = task.stages.find((s) => s.status === "failed") ?? task.stages[task.stageIndex];
      let output = "";
      if (stage?.outputPath && existsSync(stage.outputPath))
        output = readFileSync(stage.outputPath, "utf8").slice(-4000);
      return {
        title: task.title,
        stage: stage?.stageId ?? "a stage",
        error: stage?.error ?? "",
        output,
        dir: task.worktree ?? dirOf(task.projectId) ?? null,
      };
    },
    exec: (cmd, args, cwd) =>
      run(cmd, args, { cwd, timeoutMs: 60_000 }).then((r) => ({
        code: r.code,
        stdout: r.stdout,
        stderr: r.stderr,
      })),
    startSession: (input) =>
      agents.sessions.start({
        providerId: input.providerId,
        autonomy: "ask-first",
        ...(input.projectId ? { projectId: input.projectId } : {}),
        cwd: input.cwd,
        title: input.title,
        prompt: input.prompt,
        brief: input.brief,
        // A chat that asks before it acts: the permission mode of a chat is Ask first until the owner changes it.
        mode: "chat",
      }),
  });
}

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
  const { github, brief, sessions, relay, explore, recorder } = agents;
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
    recorder.stop();
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
    recorder.start();
    const archive = (): void => {
      sessions.autoArchive(store.state.workspace?.archiveAfterDays ?? 7);
      // Saved chats that nobody has used for the idle time archive themselves, unless pinned.
      sessions.archiveIdleChats(box.current.sessionIdleDays);
    };
    archive();
    archiveTimer = setInterval(archive, 3_600_000);
    const due = (): void => {
      pending.changed();
      void brief.runIfDue().catch(() => undefined);
    };
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
  storage?: SecretStorage,
): Promise<AppContext> {
  mkdirSync(dataDir(), { recursive: true });
  const base = createBase();
  const notes = createNotes(base);
  const tokens = new ClaudeTokenStore(storage);
  const agents = createAgents(base, notes, relayScript, tokens);
  const orch = createOrchestration(base, notes, agents);
  const { box, store, db, bus, notifier, ntfy } = base;
  const officeTools = new OfficeTools({
    bus, store, settings: () => box.current, sessions: agents.sessions, explore: agents.explore,
    recorder: agents.recorder, ops: notes.ops, scheduler: orch.scheduler, editor: orch.editor, tasks: orch.tasks,
    workflowResults: orch.workflowResults,
  });
  agents.relay.officeTools = {
    authorized: (id, header) => agents.conversationBridge.valid(id, header),
    request: (id, body, signal) => officeTools.request(id, body, signal),
  };
  const requestRouter = new RequestRouter({
    workspace: () => store.state.workspace,
    enabled: () => box.current.requestRouterEnabled,
    complete: async (prompt) => {
      const provider = cheapestProvider();
      const run = agents.runs.start({
        kind: "route", providerId: provider, cwd: dataDir(), prompt, tools: "",
        role: { provider, model: box.current.requestRouterModel || cheapestModel(provider), instructions: "", readOnly: true, allowedCommands: [] },
      });
      const result = await run.result;
      if (!result.ok) throw new Error(result.error || "The request could not be routed.");
      return result.resultText;
    },
    chat: (request, projectId) => {
      const session = agents.explore.start(cheapestProvider(), false, projectId);
      agents.chat.send(session.id, request);
      return session.id;
    },
  });
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
  const starterPack = () => new StarterPack(box.current.workspaceRoot, join(dirname(relayScript), "..", "brain-template"),
    store.state.workspace?.vault.kind === "folder");
  const starterDomains = () => (store.state.workspace?.projects ?? []).flatMap((project) => {
    const root = box.current.workspaceRoot;
    const domain = project.vault ? frontmatterValue(readText(notesPath(root, `${project.vault}/Overview.md`)), "domain") : null;
    const code = folderOf(notes.projects)(project.id);
    return [domain, code && detectRuleDomain(code)].filter((entry): entry is string => !!entry);
  });
  const changeStarterRules: AppContext["changeStarterRules"] = async (work, message, digest) => {
    const root = box.current.workspaceRoot;
    await notes.writer.exclusive(async () => {
      if (root !== box.current.workspaceRoot) throw new Error("The Brain changed. Review it again.");
      const paths = work(starterPack());
      await commitStarterFiles(root, paths, message);
      bus.emit("rules.changed", { starter: digest ? paths : [] });
    });
  };
  const updateStarter = () => changeStarterRules((pack) => pack.refresh(), "Update starter rules", true)
    .catch((error: unknown) => {
      notes.warnings.unshift({ at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
      bus.emit("vault.health", {});
    });
  const claude = agents.providers.get("claude-code") as ClaudeCodeProvider;
  const claudeEnv = () => {
    try { return claude.auth.env(); } catch { return {}; }
  };
  const toolsMonitor = new ToolsMonitor(() => detectTools(claudeEnv()), () => bus.emit("setup.changed", {}));
  const claudeSignIn = new ClaudeSignIn(tokens, claude, () => {
    bus.emit("setup.changed", {});
    void toolsMonitor.check().catch(() => undefined);
  });
  const toolConfig = new ToolConfigService({
    home: userHome,
    backups: () => join(dataDir(), "tool-backups"),
    project: folderOf(notes.projects),
  });
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
      proposals: () => [...agents.recorder.pending(), ...orch.workflowResults.pending(), ...starterPack().pending()],
    },
  });
  const fix = createFix(base, notes, agents, orch, pending);
  agents.github.onChange = () => pending.changed();
  // The brief says what waits on the owner, from the same list as the bell.
  agents.brief.needsYou = () => pending.list().map((i) => i.title);
  const lifecycle = createLifecycle(base, notes, agents, orch, toolsMonitor, pending);
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
    toolConfig,
    requestRouter,
    officeTools,
    starterPack,
    changeStarterRules,
    starterDomains,
    claudeSignIn,
    claudeEnv,
    permissions: agents.broker,
    pending,
    fix,
    ...orch,
    projects: notes.projects,
    vault: notes.vault,
    folderTools: notes.folderTools,
    ops: notes.ops,
    warnings: notes.warnings,
    health: notes.health,
    healthActions: notes.healthActions,
    onboarding,
    toolsMonitor,
    setupState,
    ...lifecycle,
    start: async () => { await lifecycle.start(); void updateStarter(); },
    sync: async () => { const result = await lifecycle.sync(); await updateStarter(); return result; },
    stop: async () => { claudeSignIn.cancel(); await lifecycle.stop(); },
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
