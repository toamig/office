import { z } from "zod";
import { AutonomyLevel } from "./autonomy";
import { OfficeConfirmation } from "./office-tools";
import { SessionRecap } from "./recap";
import { LimitWindow, UsageTotals, UsageView } from "./usage";
import { InstalledPlugin, ToolEdit, ToolEditPreview, ToolEntry, ToolTest, ToolTestResult } from "./tool-config";
import { CloudState } from "./cloud";
import { ClaudeTaskView, Workflow, WorkflowResult, WorkflowView } from "./workflow";
import { PermissionProfile, Pipeline, Role, Stage } from "./schemas";
import {
  AppSettings,
  AppSettingsPatch,
  AskResult,
  BranchCompare,
  BranchList,
  AuditEntry,
  BriefView,
  BriefCard,
  BriefRange,
  CreateTask,
  TaskDetail,
  TaskView,
  RecordedNote,
  RequestResult,
  DiffResult,
  FixEntry,
  FixSubject,
  GraphView,
  GithubOverview,
  RepoStatus,
  HealthView,
  HookStatus,
  Inventory,
  Layout,
  ReviewComment,
  ModuleInfo,
  PendingItem,
  PreviewBounds,
  PreviewState,
  NotificationRules,
  NotificationLink,
  NoteEntry,
  ProjectNote,
  ProviderStatus,
  PtyHistory,
  SessionRow,
  StartSession,
  OpenItemsView,
  ProjectDetail,
  ProjectSummary,
  SearchItem,
  SpawnInput,
  SpawnReport,
  SpawnStep,
  SyncReport,
  ToolStatus,
  SetupState,
  FolderScan,
  RootSuggestion,
  ScanCandidate,
  OnboardingItem,
  OnboardingReport,
  BrainResult,
  PointerPreview,
  WaitingEntry,
  WorkspaceView,
  VaultFile,
  UpdateStatus,
  WorkspaceInspection,
  WorktreeRow,
  WriteResult,
  WrapUpResult,
  RunSummary,
  BackgroundRun,
  PermissionRequest,
  InteractionAnswer,
  ChatImage,
  ChatLine,
  ChatImageSource,
  ChatFile,
  RewindPreview,
  ChatOptions,
  ChatState,
  BrainSyncState,
  DevServerState,
} from "./models";

/** Every event type the main process can publish on the bus (plan 4.5). */
const ChromeStateSchema = z.object({
  theme: z.enum(["light", "dark"]),
  background: z.string(),
  overlayColor: z.string(),
  overlaySymbol: z.string(),
});

export const eventTypes = [
  "workspace.changed",
  "project.status",
  "session.status",
  "session.output-idle",
  "run.progress",
  "run.done",
  "run.started",
  "run.stopping",
  "pending.changed",
  "fix.changed",
  "brief.changed",
  "vault.changed",
  "task.changed",
  "app.navigate",
  "preview.state",
  "permission.changed",
  "settings.changed",
  "profiles.migrated",
  "recorder.changed",
  "workflow.changed",
  /** The cloud routines were read again, or a run was reported. */
  "cloud.changed",
  "rules.changed",
  "office.confirmation",
  "app.history",
  "app.terminal-action",
  "chat.event",
  "session.activity",
  "chat.state",
  "app.update",
  /** An agent or a click asked the chat side panel to show a page or a file. */
  "chat.preview",
  /** A dev server started for a session changed (output, ready, stopped). */
  "devserver.changed",
  /** Usage was recorded, or a plan limit was reported. */
  "usage.changed",
  /** The brain's health (validation, hub status) was refreshed by the background job. */
  "vault.health",
  /** Something the welcome flow looks at changed: the settings it reads, the tools, the hooks. */
  "setup.changed",
] as const;
export type EventType = (typeof eventTypes)[number];

export interface OfficeEvent {
  type: EventType;
  at: string;
  projectId?: string;
  payload: unknown;
}

/** The IPC contract. Nothing outside this map is callable from the renderer. */
export const channels = {
  "app.ping": {
    req: z.object({ text: z.string() }),
    res: z.object({ text: z.string(), at: z.string() }),
  },
  "workspace.get": { req: z.void(), res: WorkspaceView },
  "projects.list": { req: z.void(), res: z.array(ProjectSummary) },
  "projects.get": { req: z.object({ id: z.string() }), res: ProjectDetail },
  "git.syncAll": { req: z.void(), res: SyncReport },
  "vault.openItems": { req: z.object({ projectId: z.string() }), res: OpenItemsView },
  "vault.waiting": { req: z.void(), res: z.array(WaitingEntry) },
  "vault.tickWaiting": {
    req: z.object({ projectId: z.string(), raw: z.string() }),
    res: WriteResult,
  },
  "vault.tickTodo": {
    req: z.object({
      projectId: z.string(),
      line: z.number().int().positive(),
      text: z.string(),
      checked: z.boolean(),
    }),
    res: WriteResult,
  },
  "vault.addWaiting": {
    req: z.object({
      projectId: z.string(),
      text: z.string().min(1),
      source: z.string().optional(),
    }),
    res: WriteResult,
  },
  "vault.addNote": {
    req: z.object({ projectId: z.string(), text: z.string().min(1) }),
    res: WriteResult,
  },
  "git.syncProject": { req: z.object({ id: z.string() }), res: SyncReport },
  "projects.openEditor": { req: z.object({ id: z.string() }), res: z.void() },
  "projects.openFolder": { req: z.object({ id: z.string() }), res: z.void() },
  /** The newest headless agent runs of a project (briefs, captures, task stages). */
  "projects.runs": { req: z.object({ id: z.string() }), res: z.array(RunSummary) },
  "runs.background": { req: z.object({ includeStopped: z.boolean().default(false) }), res: z.array(BackgroundRun) },
  "runs.stop": { req: z.object({ id: z.string() }), res: z.void() },
  /** The path of the project's .uproject file, or null when it is not an Unreal project. */
  "projects.unrealFile": { req: z.object({ id: z.string() }), res: z.string().nullable() },
  "projects.openUnreal": { req: z.object({ id: z.string() }), res: z.void() },
  "notes.list": { req: z.object({ projectId: z.string() }), res: z.array(NoteEntry) },
  /** Opens a note's file in the owner's editor. */
  "notes.openFile": { req: z.object({ projectId: z.string(), name: z.string() }), res: z.void() },
  "notes.read": { req: z.object({ projectId: z.string(), name: z.string() }), res: ProjectNote },
  "search.items": { req: z.void(), res: z.array(SearchItem) },
  /** The last look at the tools (a background job does the looking). */
  "setup.detectTools": { req: z.void(), res: z.array(ToolStatus) },
  /** Looks at the tools now (Check again) and answers with the result. */
  "setup.recheckTools": { req: z.void(), res: z.array(ToolStatus) },
  /** Where the welcome flow stands: the steps, which are met, and whether the app is gated on them. */
  "setup.state": { req: z.void(), res: SetupState },
  /** Remembers the projects folder (the welcome flow's second step). */
  /** Which of the workspace's projects exist under a folder, read from the workspace config. */
  "setup.scanProjectsRoot": { req: z.object({ path: z.string() }), res: FolderScan },
  /** The folder where most of the workspace's projects are, found from the workspace folder and the usual places. */
  "setup.suggestProjectsRoot": { req: z.void(), res: RootSuggestion },
  /** Tells this PC where one project's folder is (null forgets it): a per-machine exception to the projects folder. */
  "projects.locate": {
    req: z.object({ id: z.string(), path: z.string().nullable() }),
    res: z.void(),
  },
  /** Starts a new brain in a new or empty folder: the template, a git repo, and optionally a private GitHub repo. */
  "setup.createBrain": {
    req: z.object({ folder: z.string(), github: z.object({ name: z.string() }).nullable() }),
    res: BrainResult,
  },
  /** The code repos under the projects folder that are not in the workspace yet. */
  "onboarding.scan": {
    req: z.void(),
    res: z.object({
      candidates: z.array(ScanCandidate),
      unmatchedNotes: z.array(z.string()),
      /** The notes repos of a brain hub, for a project's notes to go in a folder of one. */
      hubRepos: z.array(z.string()),
    }),
  },
  /** What adding these will do, in words, before it runs. */
  "onboarding.plan": {
    req: z.object({ items: z.array(OnboardingItem) }),
    res: z.array(z.string()),
  },
  "onboarding.add": { req: z.object({ items: z.array(OnboardingItem) }), res: OnboardingReport },
  /** Remove from Office: the workspace entry only; notes, code and pointer stay. */
  "onboarding.remove": { req: z.object({ id: z.string() }), res: z.void() },
  "pointer.preview": { req: z.object({ id: z.string() }), res: PointerPreview },
  "pointer.apply": {
    req: z.object({
      ids: z.array(z.string()),
      push: z.boolean(),
      /** "auto": each repo's default (public: CLAUDE.local.md, else AGENTS.md). */
      target: z.enum(["auto", "agents", "local"]).default("auto"),
    }),
    res: OnboardingReport,
  },
  "pointer.remove": { req: z.object({ ids: z.array(z.string()) }), res: OnboardingReport },
  "setup.setProjectsRoot": { req: z.object({ path: z.string() }), res: z.void() },
  /** The welcome flow is finished: open the app. */
  "setup.complete": { req: z.void(), res: z.void() },
  /** Opens the tool's login in a terminal and answers with its session, so a step can show it in place. */
  "setup.loginSession": { req: z.object({ id: z.string() }), res: SessionRow },
  "setup.verifyLogin": { req: z.object({ id: z.string() }), res: z.boolean() },
  "setup.claudeTokenStatus": { req: z.void(), res: z.object({
    available: z.boolean(), saved: z.boolean(), phase: z.enum(["idle", "waiting", "saved", "failed"]), url: z.string().optional(),
  }) },
  "setup.startClaudeToken": { req: z.void(), res: z.void() },
  "setup.submitClaudeCode": { req: z.object({ code: z.string().trim().max(2048) }), res: z.void() },
  "setup.cancelClaudeToken": { req: z.void(), res: z.void() },
  "setup.removeClaudeToken": { req: z.void(), res: z.void() },
  /** Opens the install command of a missing tool in a terminal and answers with its session. */
  "setup.installSession": { req: z.object({ id: z.string() }), res: SessionRow },
  /** Opens the tool's own login in a terminal tab. */
  "setup.login": { req: z.object({ id: z.string() }), res: z.void() },
  /** Opens the install command of a missing tool (Codex) in a terminal tab. */
  "setup.install": { req: z.object({ id: z.string() }), res: z.void() },
  "setup.brainSync": { req: z.void(), res: BrainSyncState },
  "setup.inspect": { req: z.object({ root: z.string() }), res: WorkspaceInspection },
  "setup.clone": {
    req: z.object({ url: z.string(), dest: z.string() }),
    res: z.object({ path: z.string(), hubCloned: z.boolean() }),
  },
  "setup.apply": {
    req: z.object({
      workspaceRoot: z.string(),
      workspaceConfigPath: z.string(),
      projectsRoot: z.string(),
      createIfMissing: z.boolean(),
    }),
    res: WorkspaceView,
  },
  "setup.inventory": {
    req: z.object({ projectId: z.string().optional() }),
    res: z.array(Inventory),
  },
  "tools.list": {
    req: z.object({ projectId: z.string().optional() }),
    res: z.array(ToolEntry),
  },
  "tools.plugins": {
    req: z.object({ provider: z.enum(["claude-code", "codex"]), projectId: z.string().optional() }),
    res: z.array(InstalledPlugin),
  },
  "usage.summary": { req: z.void(), res: UsageView },
  "usage.limits": { req: z.void(), res: z.object({ claudeCode: z.array(LimitWindow).nullable(), updatedAt: z.string().nullable() }) },
  "usage.session": { req: z.object({ sessionId: z.string() }), res: UsageTotals },
  "devserver.state": { req: z.object({ sessionId: z.string() }), res: DevServerState },
  "devserver.suggest": { req: z.object({ sessionId: z.string() }), res: z.object({ command: z.string(), port: z.number().nullable() }).nullable() },
  "devserver.start": {
    req: z.object({ sessionId: z.string(), command: z.string().trim().min(1).max(500), port: z.number().int().min(1).max(65535).nullable().optional() }),
    res: DevServerState,
  },
  "devserver.stop": { req: z.object({ sessionId: z.string() }), res: z.void() },
  "tools.test": { req: ToolTest, res: ToolTestResult },
  "tools.preview": { req: ToolEdit, res: ToolEditPreview },
  "tools.apply": { req: z.object({ id: z.string() }), res: z.void() },
  "setup.pickFolder": {
    req: z.object({ title: z.string().optional() }),
    res: z.string().nullable(),
  },
  "providers.list": { req: z.void(), res: z.array(ProviderStatus) },
  "sessions.list": {
    req: z.object({ projectId: z.string().optional(), includeArchived: z.boolean().optional() }),
    res: z.array(SessionRow),
  },
  "sessions.start": { req: StartSession, res: SessionRow },
  "sessions.setAutonomy": { req: z.object({ id: z.string(), level: AutonomyLevel }), res: SessionRow },
  "sessions.startCommand": {
    req: z.object({
      title: z.string(),
      cmd: z.string(),
      args: z.array(z.string()),
      cwd: z.string().optional(),
    }),
    res: SessionRow,
  },
  "sessions.history": { req: z.object({ id: z.string() }), res: PtyHistory },
  "sessions.kill": { req: z.object({ id: z.string() }), res: z.void() },
  "sessions.resume": { req: z.object({ id: z.string() }), res: SessionRow },
  "sessions.archive": { req: z.object({ id: z.string() }), res: z.void() },
  /** One session by id, an incognito chat included (the list never has those). */
  "sessions.get": { req: z.object({ id: z.string() }), res: SessionRow },
  "sessions.pin": { req: z.object({ id: z.string(), pinned: z.boolean() }), res: z.void() },
  "sessions.keep": { req: z.object({ id: z.string() }), res: z.void() },
  "sessions.rename": { req: z.object({ id: z.string(), title: z.string() }), res: z.void() },
  "layout.get": { req: z.object({ key: z.string() }), res: Layout.nullable() },
  "layout.set": { req: z.object({ key: z.string(), layout: Layout }), res: z.void() },
  /** The saved layout of a docked workbench (its dock library's own JSON), by workbench and project. */
  "dock.get": { req: z.object({ key: z.string() }), res: z.string().nullable() },
  "dock.set": { req: z.object({ key: z.string(), json: z.string() }), res: z.void() },
  "dock.list": { req: z.object({ prefix: z.string() }), res: z.array(z.string()) },
  "dock.remove": { req: z.object({ key: z.string() }), res: z.void() },
  "hooks.status": {
    req: z.void(),
    res: z.object({
      claude: HookStatus,
      codex: HookStatus,
    }),
  },
  "hooks.preview": {
    req: z.object({
      target: z.enum(["claude", "codex"]),
      action: z.enum(["install", "uninstall"]),
    }),
    res: z.object({ path: z.string(), diff: z.string(), changed: z.boolean() }),
  },
  "hooks.apply": {
    req: z.object({
      target: z.enum(["claude", "codex"]),
      action: z.enum(["install", "uninstall"]),
    }),
    res: z.object({ backup: z.string().nullable() }),
  },
  "sessions.wrapUp": { req: z.object({ id: z.string() }), res: WrapUpResult },
  "recorder.digest": { req: z.void(), res: z.array(RecordedNote) },
  "requests.route": {
    req: z.object({ request: z.string().trim().min(1).max(6000), projectId: z.string().optional() }),
    res: RequestResult,
  },
  "office.confirmations": {
    req: z.object({ sessionId: z.string() }), res: z.array(OfficeConfirmation),
  },
  "office.confirm": {
    req: z.object({ sessionId: z.string(), id: z.string(), save: z.boolean(), edits: z.record(z.string(), z.json()).optional() }),
    res: z.void(),
  },
  "recorder.answer": { req: z.object({ id: z.string(), save: z.boolean() }), res: z.void() },
  "recorder.undo": { req: z.object({ id: z.string() }), res: z.void() },
  "ask.start": {
    req: z.object({ question: z.string().min(1), projectId: z.string().optional() }),
    res: z.object({ runId: z.string() }),
  },
  "ask.result": { req: z.object({ runId: z.string() }), res: AskResult },
  "ask.cancel": { req: z.object({ runId: z.string() }), res: z.void() },
  "vault.readFile": { req: z.object({ path: z.string() }), res: VaultFile },
  "vault.audit": { req: z.void(), res: z.array(AuditEntry) },
  "brief.latest": { req: z.void(), res: BriefView },
  "brief.run": { req: z.object({ range: BriefRange.optional() }).optional(), res: z.object({ date: z.string(), count: z.number() }) },
  /** The card of one project, by default since you last worked on it. Nothing is stored. */
  "brief.catchUp": { req: z.object({ projectId: z.string(), range: BriefRange.optional() }), res: z.object({ since: z.string(), card: BriefCard }) },
  /** The latest recap of each session that has one, for the Sessions list. */
  "sessions.recaps": { req: z.void(), res: z.record(z.string(), z.string()) },
  /** What a session did and where it left off, or null when it has no recap yet. */
  "sessions.recap": { req: z.object({ id: z.string() }), res: SessionRecap.nullable() },
  "explore.start": {
    req: z.object({ providerId: z.string().optional(), incognito: z.boolean().optional() }),
    res: SessionRow,
  },
  /** Ends a chat: an incognito one is erased, a saved one is archived. */
  "explore.close": { req: z.object({ id: z.string() }), res: z.void() },
  /** Turns incognito off for a chat, making it a saved one. */
  "explore.keep": { req: z.object({ id: z.string() }), res: SessionRow },
  "explore.list": { req: z.void(), res: z.array(SessionRow) },
  "explore.plan": { req: SpawnInput, res: z.array(SpawnStep) },
  "explore.spawn": { req: SpawnInput, res: SpawnReport },
  "git.graph": {
    req: z.object({ projectId: z.string(), limit: z.number().int().min(20).max(5000).optional() }),
    res: GraphView,
  },
  "branches.list": { req: z.object({ projectId: z.string() }), res: BranchList },
  "branches.switch": {
    req: z.object({
      projectId: z.string(),
      name: z.string(),
      stash: z.boolean().optional(),
      remote: z.boolean().optional(),
      /** Check out a commit (name is its hash): HEAD ends up on no branch. */
      detach: z.boolean().optional(),
    }),
    res: z.object({ stashed: z.boolean() }),
  },
  "branches.create": {
    req: z.object({
      projectId: z.string(),
      name: z.string(),
      from: z.string().optional(),
      switchTo: z.boolean().optional(),
    }),
    res: z.void(),
  },
  /** What one commit changed, with its message. */
  "git.show": {
    req: z.object({ projectId: z.string(), hash: z.string() }),
    res: z.object({ subject: z.string(), body: z.string(), files: DiffResult.shape.files }),
  },
  "branches.compare": {
    req: z.object({ projectId: z.string(), a: z.string(), b: z.string() }),
    res: BranchCompare,
  },
  "branches.delete": { req: z.object({ projectId: z.string(), name: z.string() }), res: z.void() },
  "branches.cleanMerged": { req: z.object({ projectId: z.string() }), res: z.array(z.string()) },
  "worktrees.list": {
    req: z.object({ projectId: z.string().optional() }),
    res: z.array(WorktreeRow),
  },
  "worktrees.create": {
    req: z.object({ projectId: z.string(), name: z.string(), base: z.string().optional() }),
    res: z.object({ path: z.string(), branch: z.string() }),
  },
  "worktrees.remove": {
    req: z.object({
      projectId: z.string(),
      path: z.string(),
      confirmOther: z.boolean().optional(),
    }),
    res: z.void(),
  },
  "worktrees.cleanMerged": { req: z.object({ projectId: z.string() }), res: z.array(z.string()) },
  "diff.get": {
    req: z.object({
      projectId: z.string(),
      dir: z.string().optional(),
      mode: z.enum(["working", "staged", "branch"]),
      base: z.string().optional(),
    }),
    res: DiffResult,
  },
  "diff.sendComments": {
    req: z.object({
      projectId: z.string(),
      dir: z.string().optional(),
      comments: z.array(ReviewComment).min(1),
    }),
    res: z.object({ sessionId: z.string(), started: z.boolean() }),
  },
  "git.status": {
    req: z.object({ projectId: z.string(), dir: z.string().optional() }),
    res: RepoStatus,
  },
  "commit.run": {
    req: z.object({
      projectId: z.string(),
      dir: z.string().optional(),
      files: z.array(z.string()).min(1),
      message: z.string(),
      push: z.boolean().optional(),
    }),
    res: z.object({ hash: z.string(), pushed: z.boolean(), pushError: z.string().optional() }),
  },
  "git.push": {
    req: z.object({ projectId: z.string(), dir: z.string().optional() }),
    res: z.object({ pushed: z.boolean(), error: z.string().optional() }),
  },
  "github.overview": { req: z.object({ projectId: z.string() }), res: GithubOverview },
  "roles.save": { req: z.object({ id: z.string(), role: Role }), res: z.void() },
  "roles.remove": { req: z.object({ id: z.string() }), res: z.void() },
  /** Adds or replaces a custom permission profile; Bypass permissions and Full access need confirmedUnsafe. */
  "profiles.save": { req: z.object({ id: z.string(), profile: PermissionProfile }), res: z.void() },
  "profiles.remove": { req: z.object({ id: z.string() }), res: z.void() },
  "pipelines.save": { req: z.object({ id: z.string(), pipeline: Pipeline }), res: z.void() },
  /** What a stage of a pipeline being edited would be sent, for a made-up task, or for a real one once it is saved. */
  "pipelines.preview": {
    req: z.object({ stages: z.array(Stage), index: z.number().int().min(0), taskId: z.string().optional() }),
    res: z.object({ prompt: z.string(), unknown: z.array(z.string()) }),
  },
  /** A pipeline drafted by the cheapest agent from a sentence, to be edited before saving. */
  "pipelines.draft": { req: z.object({ description: z.string().trim().min(3).max(1000) }), res: Pipeline },
  "pipelines.remove": { req: z.object({ id: z.string() }), res: z.void() },
  "chat.state": { req: z.object({ id: z.string() }), res: ChatState },
  "chat.history": { req: z.object({ id: z.string() }), res: z.array(ChatLine) },
  "chat.image": { req: z.object({ id: z.string(), source: ChatImageSource }), res: z.string() },
  "chat.file": { req: z.object({ id: z.string(), path: z.string() }), res: ChatFile },
  "chat.fileAction": { req: z.object({ id: z.string(), path: z.string(), action: z.enum(["open", "reveal"]) }), res: z.void() },
  "chat.previewFile": { req: z.object({ id: z.string(), path: z.string() }), res: z.void() },
  "chat.previewFileBounds": { req: PreviewBounds.extend({ id: z.string() }), res: z.void() },
  "chat.closeFilePreview": { req: z.object({ id: z.string() }), res: z.void() },
  "chat.commands": { req: z.object({ id: z.string() }), res: z.array(z.string()) },
  "chat.clear": { req: z.object({ id: z.string() }), res: z.void() },
  "chat.rewindPreview": { req: z.object({ id: z.string(), messageId: z.string() }), res: RewindPreview },
  "chat.rewindFiles": { req: z.object({ id: z.string(), messageId: z.string(), revision: z.string() }), res: z.void() },
  "chat.send": {
    req: z.object({
      id: z.string(),
      text: z.string().trim().min(1),
      images: z.array(ChatImage).optional(),
      options: ChatOptions.optional(),
    }),
    res: z.void(),
  },
  "chat.queueEdit": { req: z.object({ id: z.string(), messageId: z.string(), text: z.string().trim().min(1) }), res: z.void() },
  "chat.queueRemove": { req: z.object({ id: z.string(), messageId: z.string() }), res: z.void() },
  "chat.queueSend": { req: z.object({ id: z.string(), messageId: z.string() }), res: z.void() },
  /** The model and permission mode picked in the chat header; they apply from the next message. */
  "chat.setOptions": { req: z.object({ id: z.string(), options: ChatOptions }), res: z.void() },
  "chat.resend": { req: z.object({
    id: z.string(), messageId: z.string(), text: z.string().trim().min(1).optional(), useDefault: z.boolean().optional(),
  }), res: z.void() },
  "chat.stop": { req: z.object({ id: z.string() }), res: z.void() },
  /** Project files that match what the owner typed after @ in the composer. */
  "chat.files": { req: z.object({ id: z.string(), query: z.string() }), res: z.array(z.string()) },
  "chat.toTerminal": { req: z.object({ id: z.string() }), res: SessionRow },
  "chat.toChat": { req: z.object({ id: z.string() }), res: SessionRow },
  "permissions.list": { req: z.void(), res: z.array(PermissionRequest) },
  "permissions.interact": { req: z.object({ id: z.string(), answer: InteractionAnswer }), res: z.void() },
  /** Answers one waiting request: allow it once, or deny it with an optional reason. */
  "permissions.answer": {
    req: z.object({ id: z.string(), allow: z.boolean(), reason: z.string().optional() }),
    res: z.void(),
  },
  /** The colours the native window chrome was last given (for tests and the title bar). */
  /** Pops up the native Copy and Paste menu of a terminal; the choice comes back as app.terminal-action. */
  "app.terminalMenu": { req: z.object({ hasSelection: z.boolean() }), res: z.void() },
  /** Pops up a native menu where the pointer is; answers the id of the chosen item, or null. */
  "app.popupMenu": {
    req: z.object({
      items: z.array(
        z.object({ id: z.string(), label: z.string(), enabled: z.boolean().optional() }),
      ),
    }),
    res: z.string().nullable(),
  },
  "app.chrome": { req: z.void(), res: ChromeStateSchema },
  "projects.update": {
    req: z.object({
      id: z.string(),
      pinned: z.boolean().optional(),
      /** null or an empty string removes the group. */
      group: z.string().nullable().optional(),
      archived: z.boolean().optional(),
    }),
    res: z.void(),
  },
  "roles.setOverride": {
    req: z.object({ projectId: z.string(), role: z.string(), target: z.string().nullable() }),
    res: z.void(),
  },
  "workflows.list": { req: z.void(), res: z.array(WorkflowView) },
  "workflows.save": { req: Workflow, res: z.void() },
  "workflows.create": { req: Workflow, res: z.void() },
  "workflows.setEnabled": { req: z.object({ id: z.string(), enabled: z.boolean() }), res: z.void() },
  "workflows.remove": { req: z.object({ id: z.string() }), res: z.void() },
  "workflows.runNow": { req: z.object({ id: z.string() }), res: z.void() },
  "workflows.claudeTasks": { req: z.void(), res: z.array(ClaudeTaskView) },
  "workflows.moveClaudeTask": {
    req: z.object({ id: z.string(), schedule: z.string().nullable().optional(), projectId: z.string().nullable().optional() }),
    res: z.object({ workflowId: z.string() }),
  },
  "cloud.state": { req: z.void(), res: CloudState },
  "cloud.refresh": { req: z.void(), res: CloudState },
  "workflows.results": { req: z.void(), res: z.array(WorkflowResult) },
  "workflows.discuss": { req: z.object({ id: z.string() }), res: NotificationLink },
  "workflows.later": { req: z.object({ id: z.string() }), res: z.void() },
  "workflows.dismiss": { req: z.object({ id: z.string() }), res: z.void() },
  "settings.get": { req: z.void(), res: AppSettings },
  "settings.set": { req: AppSettingsPatch, res: AppSettings },
  "notifications.setRules": { req: NotificationRules, res: z.void() },
  "notifications.testPing": { req: z.void(), res: z.void() },
  "modules.list": { req: z.void(), res: z.array(ModuleInfo) },
  "modules.setEnabled": {
    req: z.object({ name: z.string(), enabled: z.boolean() }),
    res: z.array(ModuleInfo),
  },
  "preview.open": { req: z.object({ url: z.string(), owner: z.string().optional() }), res: PreviewState },
  "preview.bounds": { req: PreviewBounds.extend({ owner: z.string().optional() }), res: z.void() },
  "preview.act": {
    req: z.object({ action: z.enum(["back", "forward", "reload", "stop", "external", "close"]), owner: z.string().optional() }),
    res: PreviewState,
  },
  "preview.state": { req: z.object({ owner: z.string().optional() }).optional(), res: PreviewState },
  "preview.detect": { req: z.void(), res: z.string().nullable() },
  "app.update.status": { req: z.void(), res: UpdateStatus },
  "app.update.check": { req: z.void(), res: UpdateStatus },
  "app.update.install": { req: z.void(), res: z.void() },
  "tasks.list": { req: z.object({ projectId: z.string().optional() }), res: z.array(TaskView) },
  "tasks.get": { req: z.object({ id: z.string() }), res: TaskDetail },
  "tasks.create": { req: CreateTask, res: TaskView },
  "tasks.approve": { req: z.object({ id: z.string() }), res: z.void() },
  "tasks.reject": { req: z.object({ id: z.string(), comment: z.string() }), res: z.void() },
  "tasks.record": { req: z.object({ id: z.string() }), res: z.void() },
  "tasks.keep": { req: z.object({ id: z.string(), variant: z.number() }), res: z.void() },
  "tasks.cancel": { req: z.object({ id: z.string() }), res: z.void() },
  "tasks.retry": { req: z.object({ id: z.string() }), res: z.void() },
  "pending.list": { req: z.void(), res: z.array(PendingItem) },
  /** Starts a chat session at once, in the folder of the problem, with Ask first and a first message that says everything Office knows. */
  "fix.start": { req: FixSubject, res: SessionRow },
  /** The problems that have a session fixing them, whose session is still open. */
  "fix.list": { req: z.void(), res: z.array(FixEntry) },
  "pending.dismiss": {
    req: z.object({ key: z.string(), fingerprint: z.string() }),
    res: z.void(),
  },
  "vault.health": { req: z.void(), res: HealthView },
  "vault.validate": { req: z.void(), res: HealthView },
  "vault.reindex": { req: z.void(), res: z.object({ count: z.number() }) },
  "rules.status": { req: z.void(), res: z.object({
    add: z.array(z.string()),
    conflicts: z.array(z.object({ path: z.string(), before: z.string(), after: z.string(), diff: z.string() })),
    undo: z.array(z.string()),
  }) },
  "rules.add": { req: z.object({ files: z.array(z.string()) }), res: z.void() },
  "rules.answer": { req: z.object({ path: z.string(), before: z.string(), after: z.string(), accept: z.boolean() }), res: z.void() },
  "rules.undo": { req: z.void(), res: z.void() },
  "rules.globalStatus": { req: z.void(), res: z.object({
    available: z.boolean(), undo: z.boolean(),
    tools: z.array(z.object({ id: z.string(), label: z.string(), installed: z.boolean(), conflict: z.boolean() })),
  }) },
  "rules.globalPreview": { req: z.object({ remove: z.boolean() }), res: z.object({
    id: z.string(), changes: z.array(z.object({ label: z.string(), file: z.string(), diff: z.string() })),
  }) },
  "rules.globalApply": { req: z.object({ id: z.string() }), res: z.void() },
  "rules.globalUndo": { req: z.void(), res: z.void() },
  "rules.gitStatus": { req: z.object({ projectId: z.string().optional() }), res: z.array(z.object({
    name: z.string(), installed: z.boolean(),
  })) },
  "rules.gitConfigure": { req: z.object({ projectId: z.string().optional(), enabled: z.boolean() }), res: z.void() },
  /** What is uncommitted in one of the brain's repos ("." is the hub), with each file's changes. */
  "health.changes": { req: z.object({ folder: z.string() }), res: DiffResult },
  "health.commit": {
    req: z.object({ folder: z.string(), message: z.string() }),
    res: z.object({ hash: z.string() }),
  },
  /** Throws the uncommitted changes of a brain repo away; the screen asks first. */
  "health.discard": { req: z.object({ folder: z.string() }), res: z.void() },
  "health.pull": { req: z.object({ folder: z.string() }), res: z.void() },
  "health.push": { req: z.object({ folder: z.string() }), res: z.void() },
  "projects.refresh": { req: z.object({ id: z.string().optional() }), res: z.void() },
} as const;

export type ChannelName = keyof typeof channels;
export type ChannelReq<C extends ChannelName> = z.infer<(typeof channels)[C]["req"]>;
export type ChannelRes<C extends ChannelName> = z.infer<(typeof channels)[C]["res"]>;

/** Errors cross IPC as this shape, never as raw stacks. */
export interface IpcError {
  code: string;
  message: string;
}
export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export { IPC_EVENT, IPC_INVOKE, IPC_PTY_DATA, IPC_PTY_RESIZE, IPC_PTY_WRITE } from "./ipc-names";

/** The whole surface preload exposes as window.office. */
export interface OfficeApi {
  invoke<C extends ChannelName>(
    channel: C,
    ...payload: ChannelReq<C> extends void ? [] : [ChannelReq<C>]
  ): Promise<ChannelRes<C>>;
  on(type: EventType | "*", cb: (event: OfficeEvent) => void): () => void;
  pty: {
    /** `end` is the running total of characters after this chunk, to line up with history. */
    onData(id: string, cb: (data: string, end: number) => void): () => void;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
  };
}
