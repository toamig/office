import { z } from "zod";
import { Automation, Role } from "./schemas";
import {
  AskResult,
  AutomationView,
  BranchCompare,
  BranchList,
  AuditEntry,
  BriefView,
  CaptureCommit,
  CreateTask,
  TaskDetail,
  TaskView,
  CaptureResult,
  DiffResult,
  GithubOverview,
  RepoStatus,
  HealthView,
  HookStatus,
  Inventory,
  Layout,
  ReviewComment,
  NotificationFilter,
  NotificationRow,
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
  WaitingEntry,
  WorkspaceView,
  VaultFile,
  WorkspaceInspection,
  WorktreeRow,
  WriteResult,
} from "./models";

/** Every event type the main process can publish on the bus (plan 4.5). */
export const eventTypes = [
  "workspace.changed",
  "project.status",
  "session.status",
  "session.output-idle",
  "run.progress",
  "run.done",
  "notification.new",
  "notification.read",
  "vault.changed",
  "task.changed",
  "app.navigate",
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
  "notes.read": { req: z.object({ projectId: z.string(), name: z.string() }), res: ProjectNote },
  "search.items": { req: z.void(), res: z.array(SearchItem) },
  "setup.detectTools": { req: z.void(), res: z.array(ToolStatus) },
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
  "sessions.rename": { req: z.object({ id: z.string(), title: z.string() }), res: z.void() },
  "layout.get": { req: z.object({ key: z.string() }), res: Layout.nullable() },
  "layout.set": { req: z.object({ key: z.string(), layout: Layout }), res: z.void() },
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
  "capture.run": { req: z.object({ id: z.string() }), res: CaptureResult },
  "capture.commit": { req: CaptureCommit, res: z.object({ saved: z.number() }) },
  "ask.start": {
    req: z.object({ question: z.string().min(1), projectId: z.string().optional() }),
    res: z.object({ runId: z.string() }),
  },
  "ask.result": { req: z.object({ runId: z.string() }), res: AskResult },
  "ask.cancel": { req: z.object({ runId: z.string() }), res: z.void() },
  "vault.readFile": { req: z.object({ path: z.string() }), res: VaultFile },
  "vault.audit": { req: z.void(), res: z.array(AuditEntry) },
  "brief.latest": { req: z.void(), res: BriefView },
  "brief.run": { req: z.void(), res: z.object({ date: z.string(), count: z.number() }) },
  "explore.start": {
    req: z.object({ providerId: z.string().optional(), title: z.string().optional() }),
    res: SessionRow,
  },
  "explore.list": { req: z.void(), res: z.array(SessionRow) },
  "explore.plan": { req: SpawnInput, res: z.array(SpawnStep) },
  "explore.spawn": { req: SpawnInput, res: SpawnReport },
  "branches.list": { req: z.object({ projectId: z.string() }), res: BranchList },
  "branches.switch": {
    req: z.object({
      projectId: z.string(),
      name: z.string(),
      stash: z.boolean().optional(),
      remote: z.boolean().optional(),
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
  "roles.setOverride": {
    req: z.object({ projectId: z.string(), role: z.string(), target: z.string().nullable() }),
    res: z.void(),
  },
  "automations.list": { req: z.void(), res: z.array(AutomationView) },
  "automations.save": { req: Automation, res: z.void() },
  "automations.remove": { req: z.object({ id: z.string() }), res: z.void() },
  "automations.runNow": { req: z.object({ id: z.string() }), res: z.void() },
  "tasks.list": { req: z.object({ projectId: z.string().optional() }), res: z.array(TaskView) },
  "tasks.get": { req: z.object({ id: z.string() }), res: TaskDetail },
  "tasks.create": { req: CreateTask, res: TaskView },
  "tasks.approve": { req: z.object({ id: z.string() }), res: z.void() },
  "tasks.reject": { req: z.object({ id: z.string(), comment: z.string() }), res: z.void() },
  "tasks.record": { req: z.object({ id: z.string() }), res: z.void() },
  "tasks.keep": { req: z.object({ id: z.string(), variant: z.number() }), res: z.void() },
  "tasks.cancel": { req: z.object({ id: z.string() }), res: z.void() },
  "tasks.retry": { req: z.object({ id: z.string() }), res: z.void() },
  "notifications.list": { req: NotificationFilter, res: z.array(NotificationRow) },
  "notifications.markRead": {
    req: z.object({ ids: z.array(z.string()).optional() }),
    res: z.void(),
  },
  "notifications.counts": {
    req: z.void(),
    res: z.object({ unread: z.number(), urgentUnread: z.number() }),
  },
  "vault.health": { req: z.void(), res: HealthView },
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
