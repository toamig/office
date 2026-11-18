import { z } from "zod";
import { Workspace } from "./schemas";

/** What the renderer learns about the app configuration. Never includes the relay token. */
export const WorkspaceView = z.object({
  configured: z.boolean(),
  workspaceRoot: z.string(),
  workspaceConfigPath: z.string(),
  projectsRoot: z.string(),
  editorCommand: z.string(),
  workspace: Workspace.nullable(),
  error: z.string().nullable(),
});
export type WorkspaceView = z.infer<typeof WorkspaceView>;

export const RunSummary = z.object({
  id: z.string(),
  kind: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  status: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const GitFile = z.object({
  path: z.string(),
  origPath: z.string().optional(),
  /** Index (staged) status letter, "." when unchanged. */
  index: z.string(),
  /** Worktree (unstaged) status letter, "." when unchanged. */
  worktree: z.string(),
  kind: z.enum(["ordinary", "renamed", "unmerged", "untracked"]),
});
export type GitFile = z.infer<typeof GitFile>;

export const RepoStatus = z.object({
  branch: z.string().nullable(),
  detached: z.boolean(),
  oid: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  files: z.array(GitFile),
  staged: z.number(),
  unstaged: z.number(),
  untracked: z.number(),
  conflicted: z.number(),
});
export type RepoStatus = z.infer<typeof RepoStatus>;

export const LastCommit = z.object({ hash: z.string(), subject: z.string(), date: z.string() });
export type LastCommit = z.infer<typeof LastCommit>;

export const ProjectSummary = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string().optional(),
  pinned: z.boolean(),
  archived: z.boolean(),
  /** Absolute path of the code folder. */
  path: z.string(),
  exists: z.boolean(),
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.string().nullable(),
  changed: z.number(),
  ahead: z.number(),
  behind: z.number(),
  waiting: z.number(),
  lastActivity: z.string().nullable(),
  statusAt: z.string().nullable(),
  error: z.string().optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectDetail = z.object({
  summary: ProjectSummary,
  status: RepoStatus.nullable(),
  lastCommit: LastCommit.nullable(),
  origin: z.string().nullable(),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const SyncAction = z.enum([
  "pulled",
  "pushed",
  "pulled-and-pushed",
  "up-to-date",
  "conflict",
  "skipped",
  "failed",
]);
export type SyncAction = z.infer<typeof SyncAction>;

export const SyncRepoResult = z.object({
  /** Project id, or "hub:<folder>" for a nested brain repo reported by the hub tool. */
  id: z.string(),
  name: z.string(),
  action: SyncAction,
  /** Why a repo was skipped or failed, in plain words. */
  reason: z.string().optional(),
  /** True when the push step failed (raises git.push-failed). */
  pushFailed: z.boolean().optional(),
});
export type SyncRepoResult = z.infer<typeof SyncRepoResult>;

export const SyncReport = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  repos: z.array(SyncRepoResult),
});
export type SyncReport = z.infer<typeof SyncReport>;

export const WaitingItem = z.object({
  date: z.string(),
  text: z.string(),
  source: z.string().optional(),
  /** The exact line as it is in the file, used to remove it again. */
  raw: z.string(),
  line: z.number(),
});
export type WaitingItem = z.infer<typeof WaitingItem>;

export const TodoItem = z.object({
  text: z.string(),
  checked: z.boolean().nullable(),
  line: z.number(),
});
export type TodoItem = z.infer<typeof TodoItem>;

export const TodoGroup = z.object({ heading: z.string(), items: z.array(TodoItem) });
export type TodoGroup = z.infer<typeof TodoGroup>;

export const OpenItemsView = z.object({
  projectId: z.string(),
  /** Absolute path of the OpenItems file, or null when the project has no vault folder. */
  file: z.string().nullable(),
  exists: z.boolean(),
  waiting: z.array(WaitingItem),
  unparsed: z.array(z.object({ line: z.number(), text: z.string() })),
  groups: z.array(TodoGroup),
});
export type OpenItemsView = z.infer<typeof OpenItemsView>;

export const WaitingEntry = WaitingItem.extend({ projectId: z.string(), projectName: z.string() });
export type WaitingEntry = z.infer<typeof WaitingEntry>;

export const HubRepoRow = z.object({
  folder: z.string(),
  last: z.string(),
  state: z.string(),
  uncommitted: z.number(),
  ahead: z.number(),
  behind: z.number(),
  attention: z.boolean(),
  /** The checked-out branch, read from the repo itself; absent when the folder is not a repo here. */
  branch: z.string().optional(),
});
export type HubRepoRow = z.infer<typeof HubRepoRow>;

export const HealthView = z.object({
  validate: z.object({
    ran: z.boolean(),
    ok: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.number(),
    summary: z.string().nullable(),
  }),
  repos: z.array(HubRepoRow),
  warnings: z.array(z.object({ at: z.string(), message: z.string() })),
});
export type HealthView = z.infer<typeof HealthView>;

export const WriteResult = z.object({
  committed: z.boolean(),
  pushed: z.boolean(),
  pushError: z.string().optional(),
  validateErrors: z.array(z.string()),
});
export type WriteResult = z.infer<typeof WriteResult>;

export const NotificationKind = z.enum([
  "agent.needs-you",
  "agent.done",
  "agent.failed",
  "git.conflict",
  "git.push-failed",
  "git.behind",
  "ci.failed",
  "pr.review-requested",
  "vault.waiting-new",
  "vault.write-failed",
  "task.gate",
  "task.done",
  "automation.done",
  "brief.ready",
  "permission.request",
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationLink = z.object({
  view: z.string(),
  params: z.record(z.string(), z.string()).optional(),
});
export type NotificationLink = z.infer<typeof NotificationLink>;

export const NotificationRow = z.object({
  id: z.string(),
  kind: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  link: NotificationLink.nullable(),
  urgent: z.boolean(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationRow = z.infer<typeof NotificationRow>;

/** A headless builder asking whether it may run something outside its role's allowed commands. */
export const PermissionRequest = z.object({
  id: z.string(),
  runId: z.string(),
  taskId: z.string().nullable(),
  projectId: z.string().nullable(),
  /** What the task or run is called, for the Inbox line. */
  subject: z.string(),
  toolName: z.string(),
  /** The command or file the tool wants to use, short enough for a button row. */
  summary: z.string(),
  /** The tool's full input as text. */
  detail: z.string(),
  createdAt: z.string(),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

export const NotificationFilter = z.object({
  unread: z.boolean().optional(),
  urgent: z.boolean().optional(),
  projectId: z.string().optional(),
  limit: z.number().int().positive().optional(),
});
export type NotificationFilter = z.infer<typeof NotificationFilter>;

export const ProjectNote = z.object({
  projectId: z.string(),
  name: z.string(),
  exists: z.boolean(),
  /** Markdown body with the frontmatter removed. */
  markdown: z.string(),
});
export type ProjectNote = z.infer<typeof ProjectNote>;

export const SearchItem = z.object({
  kind: z.enum(["project", "note", "branch", "worktree", "session"]),
  label: z.string(),
  detail: z.string().optional(),
  link: z.object({ view: z.string(), params: z.record(z.string(), z.string()).optional() }),
});
export type SearchItem = z.infer<typeof SearchItem>;

export const ToolStatus = z.object({
  id: z.string(),
  label: z.string(),
  installed: z.boolean(),
  version: z.string().optional(),
  /** null when the tool has no login (git, node) or the state is unknown. */
  loggedIn: z.boolean().nullable(),
  problem: z.string().optional(),
  fix: z.string().optional(),
});
export type ToolStatus = z.infer<typeof ToolStatus>;

export const InventoryItem = z.object({
  kind: z.enum(["skill", "plugin", "mcp", "hook", "model", "notify"]),
  name: z.string(),
  detail: z.string().optional(),
  source: z.enum(["user", "project"]),
});
export type InventoryItem = z.infer<typeof InventoryItem>;

export const Inventory = z.object({
  provider: z.string(),
  label: z.string(),
  items: z.array(InventoryItem),
});
export type Inventory = z.infer<typeof Inventory>;

export const WorkspaceInspection = z.object({
  exists: z.boolean(),
  isGitRepo: z.boolean(),
  hasBrainHub: z.boolean(),
  /** Config files found under the folder, relative paths (workspace.json). */
  configs: z.array(z.string()),
});
export type WorkspaceInspection = z.infer<typeof WorkspaceInspection>;

export const ProviderStatus = z.object({
  id: z.string(),
  label: z.string(),
  installed: z.boolean(),
  version: z.string().optional(),
  loggedIn: z.boolean().nullable(),
  problem: z.string().optional(),
  models: z.array(z.string()),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const SessionStatus = z.enum([
  "starting",
  "working",
  "needs-you",
  "idle",
  "exited",
  "failed",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** How a session is shown: as a chat, or as a terminal running the real program. */
export const SessionMode = z.enum(["chat", "terminal"]);
export type SessionMode = z.infer<typeof SessionMode>;

/** An image pasted into the composer, sent with the message. */
export const ChatImage = z.object({
  /** For example image/png. */
  mediaType: z.string(),
  /** The image bytes, base64 encoded. */
  data: z.string(),
});
export type ChatImage = z.infer<typeof ChatImage>;

/**
 * What a chat shows, one event at a time, whichever program is underneath. The main process turns the
 * provider's stream into these, stores them as JSON lines in the session's folder, and sends them to the
 * chat view; the view builds its messages from them with the reducer in shared/chat.ts.
 */
export const ChatEvent = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("user"),
    id: z.string(),
    text: z.string(),
    images: z.number().default(0),
  }),
  z.object({ t: z.literal("turn-start") }),
  /** A new assistant message begins (its text streams in as text-delta events). */
  z.object({ t: z.literal("assistant-start"), id: z.string() }),
  z.object({ t: z.literal("text-delta"), id: z.string(), text: z.string() }),
  z.object({ t: z.literal("thinking-delta"), id: z.string(), text: z.string() }),
  /** The finished assistant message: its text, its thinking and its tool calls, replacing what streamed. */
  z.object({
    t: z.literal("assistant"),
    id: z.string(),
    text: z.string(),
    thinking: z.string().default(""),
  }),
  z.object({
    t: z.literal("tool-use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    t: z.literal("tool-result"),
    toolUseId: z.string(),
    output: z.string(),
    isError: z.boolean().default(false),
  }),
  /** The end of a turn. */
  z.object({
    t: z.literal("result"),
    ok: z.boolean(),
    durationMs: z.number().nullable().default(null),
    error: z.string().optional(),
  }),
  z.object({ t: z.literal("error"), message: z.string() }),
  /** The owner stopped the turn, or the process went away. */
  z.object({ t: z.literal("stopped") }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;

/** A stored or live chat event with its place in the conversation. */
export const ChatLine = z.object({ seq: z.number(), at: z.string(), event: ChatEvent });
export type ChatLine = z.infer<typeof ChatLine>;

/** What the chat's header lets the owner choose. */
export const ChatOptions = z.object({
  model: z.string().optional(),
  /** Claude Code's permission mode; for Codex the sandbox is shown instead. */
  permissionMode: z.string().optional(),
});
export type ChatOptions = z.infer<typeof ChatOptions>;

export const ChatState = z.object({
  mode: SessionMode,
  /** "claude" runs one process per chat; "codex" runs one per turn in a sandbox. */
  kind: z.enum(["claude", "codex"]),
  /** True while a turn runs. */
  working: z.boolean(),
  /** The sandbox of a Codex chat (shown in the header); empty for Claude Code. */
  sandbox: z.string(),
  models: z.array(z.string()),
  permissionModes: z.array(z.string()),
  options: ChatOptions,
});
export type ChatState = z.infer<typeof ChatState>;

export const SessionRow = z.object({
  id: z.string(),
  provider: z.string(),
  providerSessionId: z.string().nullable(),
  projectId: z.string().nullable(),
  cwd: z.string(),
  branch: z.string().nullable(),
  role: z.string().nullable(),
  title: z.string().nullable(),
  status: SessionStatus,
  interactive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  lastOutputAt: z.string().nullable(),
  capturedAt: z.string().nullable(),
  /** True while the terminal process is alive (or, for a chat, while its program is). */
  running: z.boolean(),
  /** Whether the session is a chat or a terminal. Sessions made before chats existed are terminals. */
  mode: SessionMode,
});
export type SessionRow = z.infer<typeof SessionRow>;

export const StartSession = z.object({
  /** A role id from the workspace config; its provider, model and instructions are used. */
  roleId: z.string().optional(),
  /** Used when no role is given. */
  providerId: z.string().optional(),
  model: z.string().optional(),
  projectId: z.string().optional(),
  /** Folder to run in; defaults to the project folder. */
  cwd: z.string().optional(),
  title: z.string().optional(),
  prompt: z.string().optional(),
  /** Chat or terminal; the machine setting decides when this is left out. */
  mode: SessionMode.optional(),
});
export type StartSession = z.infer<typeof StartSession>;

export const PtyHistory = z.object({ data: z.string(), upTo: z.number() });
export type PtyHistory = z.infer<typeof PtyHistory>;

export const Layout = z.object({
  /** Open tabs, as session ids, in order. */
  open: z.array(z.string()),
  active: z.string().nullable(),
  split: z.enum(["single", "columns", "rows", "grid"]),
  /** Sessions shown side by side (at most four). */
  panes: z.array(z.string()).max(4),
});
export type Layout = z.infer<typeof Layout>;

export const HookStatus = z.object({
  installed: z.boolean(),
  path: z.string(),
  exists: z.boolean(),
  /** The notify command Codex runs today. */
  notify: z.string().optional(),
});
export type HookStatus = z.infer<typeof HookStatus>;

export const CaptureItem = z.object({ text: z.string(), kind: z.enum(["waiting", "todo"]) });
export type CaptureItem = z.infer<typeof CaptureItem>;

export const CaptureResult = z.object({
  /** False for tools that cannot be resumed headless (Codex): the dialog opens empty. */
  supported: z.boolean(),
  items: z.array(CaptureItem),
  runId: z.string().nullable(),
  error: z.string().optional(),
});
export type CaptureResult = z.infer<typeof CaptureResult>;

export const CaptureCommit = z.object({
  id: z.string(),
  items: z.array(z.object({ text: z.string(), dest: z.enum(["waiting", "todo", "drop"]) })),
  /** False keeps the session open once its leftovers are saved; auto-archive then closes it after quiet days. */
  archive: z.boolean().optional(),
});
export type CaptureCommit = z.infer<typeof CaptureCommit>;

export const AskResult = z.object({
  done: z.boolean(),
  ok: z.boolean(),
  text: z.string(),
  /** Vault-relative note paths the answer cites, only those that exist. */
  citations: z.array(z.string()),
  error: z.string().optional(),
});
export type AskResult = z.infer<typeof AskResult>;

export const AuditEntry = z.object({ repo: z.string(), entries: z.array(z.string()) });
export type AuditEntry = z.infer<typeof AuditEntry>;

export const VaultFile = z.object({ path: z.string(), markdown: z.string() });
export type VaultFile = z.infer<typeof VaultFile>;

export const BriefItem = z.object({
  projectId: z.string(),
  projectName: z.string(),
  markdown: z.string(),
});
export type BriefItem = z.infer<typeof BriefItem>;

export const BriefView = z.object({
  /** Local date (YYYY-MM-DD) of the newest brief, or null when none was written yet. */
  date: z.string().nullable(),
  items: z.array(BriefItem),
});
export type BriefView = z.infer<typeof BriefView>;

export const SpawnInput = z.object({
  name: z.string().min(1),
  /** Folder under the projects root; defaults to the name without spaces. */
  folder: z.string().optional(),
  visibility: z.enum(["public", "private"]),
  license: z.enum(["mit", "none"]),
  group: z.string().optional(),
  /** What it is built on, one line. Goes into the README and AGENTS.md. */
  stack: z.string().default(""),
  /** The brain repo's domain for the new project. */
  domain: z.enum(["ue5", "saas", "webgames", "mobile", "meta"]).default("saas"),
  /** The Explore session whose conclusions are written into the new notes. */
  exploreSessionId: z.string().optional(),
  /** Creating anything public needs this to be true, set by its own checkbox. */
  publicConfirmed: z.boolean().default(false),
});
export type SpawnInput = z.infer<typeof SpawnInput>;

export const SpawnStep = z.object({
  id: z.string(),
  label: z.string(),
  /** The exact commands and files, shown before anything runs. */
  detail: z.array(z.string()),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  result: z.string().optional(),
});
export type SpawnStep = z.infer<typeof SpawnStep>;

export const SpawnReport = z.object({
  steps: z.array(SpawnStep),
  ok: z.boolean(),
  /** The id of the step that failed, when one did. */
  failedAt: z.string().optional(),
  /** What was created, so the owner knows where things are after a stop. */
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
});
export type SpawnReport = z.infer<typeof SpawnReport>;

export const BranchInfo = z.object({
  name: z.string(),
  current: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  gone: z.boolean(),
  lastCommit: z.string().nullable(),
  subject: z.string(),
  hash: z.string(),
  remote: z.boolean(),
  /** Merged into the default branch (local branches only). */
  merged: z.boolean(),
});
export type BranchInfo = z.infer<typeof BranchInfo>;

export const BranchList = z.object({
  current: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  local: z.array(BranchInfo),
  remote: z.array(BranchInfo),
});
export type BranchList = z.infer<typeof BranchList>;

export const BranchCompare = z.object({
  a: z.string(),
  b: z.string(),
  onlyInA: z.array(z.string()),
  onlyInB: z.array(z.string()),
  stat: z.string(),
});
export type BranchCompare = z.infer<typeof BranchCompare>;

export const WorktreeInfo = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string(),
  detached: z.boolean(),
  locked: z.boolean(),
  prunable: z.boolean(),
  /** Number of changed files. */
  dirty: z.number(),
  /** main checkout, made by Office, made by the Claude app, or another tool. */
  kind: z.enum(["main", "office", "claude", "other"]),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfo>;

export const WorktreeRow = WorktreeInfo.extend({ projectId: z.string(), projectName: z.string() });
export type WorktreeRow = z.infer<typeof WorktreeRow>;

export const DiffLine = z.object({
  kind: z.enum(["ctx", "add", "del"]),
  oldNo: z.number().nullable(),
  newNo: z.number().nullable(),
  text: z.string(),
});
export type DiffLine = z.infer<typeof DiffLine>;

export const DiffHunk = z.object({ header: z.string(), lines: z.array(DiffLine) });
export type DiffHunk = z.infer<typeof DiffHunk>;

export const DiffFile = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(["modified", "added", "deleted", "renamed"]),
  binary: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  truncated: z.boolean(),
  hunks: z.array(DiffHunk),
});
export type DiffFile = z.infer<typeof DiffFile>;

export const DiffResult = z.object({ files: z.array(DiffFile) });
export type DiffResult = z.infer<typeof DiffResult>;

export const ReviewComment = z.object({
  file: z.string(),
  line: z.number(),
  text: z.string().min(1),
});
export type ReviewComment = z.infer<typeof ReviewComment>;

export const PrInfo = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  headRefName: z.string(),
  reviewDecision: z.string().nullable(),
  url: z.string(),
});
export type PrInfo = z.infer<typeof PrInfo>;

export const RunInfo = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  headBranch: z.string(),
  url: z.string(),
});
export type RunInfo = z.infer<typeof RunInfo>;

export const GithubOverview = z.object({
  /** False when the repo's origin is not on GitHub, so there is nothing to ask gh about. */
  isGithub: z.boolean(),
  prs: z.array(PrInfo),
  runs: z.array(RunInfo),
  error: z.string().optional(),
});
export type GithubOverview = z.infer<typeof GithubOverview>;

export const TaskVariant = z.object({
  n: z.number(),
  branch: z.string(),
  worktree: z.string(),
  /** running, done (finished, not chosen yet), failed, kept or discarded. */
  status: z.enum(["running", "done", "failed", "kept", "discarded"]),
  error: z.string().nullable(),
  /** Check results: the run's outcome and what the builder changed against the task branch. */
  commits: z.number(),
  files: z.array(z.string()),
  additions: z.number(),
  deletions: z.number(),
});
export type TaskVariant = z.infer<typeof TaskVariant>;

export const TaskStageView = z.object({
  idx: z.number(),
  stageId: z.string(),
  role: z.string(),
  provider: z.string().nullable(),
  gate: z.boolean(),
  worktree: z.boolean(),
  status: z.enum([
    "pending",
    "running",
    "waiting-gate",
    "waiting-permission",
    "approved",
    "done",
    "failed",
  ]),
  runId: z.string().nullable(),
  outputPath: z.string().nullable(),
  approvedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type TaskStageView = z.infer<typeof TaskStageView>;

export const TaskStatus = z.enum([
  "running",
  "waiting-gate",
  "waiting-permission",
  "done",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskView = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  pipeline: z.string(),
  pipelineName: z.string(),
  title: z.string(),
  description: z.string(),
  branch: z.string().nullable(),
  worktree: z.string().nullable(),
  stageIndex: z.number(),
  /** How many builders run in parallel on the build stage (1 means no fan-out). */
  fanout: z.number(),
  /** True once the owner recorded the finished task in the project notes. */
  recorded: z.boolean(),
  status: TaskStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.array(TaskStageView),
});
export type TaskView = z.infer<typeof TaskView>;

export const TaskDetail = TaskView.extend({
  /** Stage outputs by stage id, as text (plans, reviews). */
  outputs: z.record(z.string(), z.string()),
  /** The builders of a fan-out stage, with their check results. */
  variants: z.array(TaskVariant),
});
export type TaskDetail = z.infer<typeof TaskDetail>;

export const CreateTask = z.object({
  projectId: z.string(),
  pipeline: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  /** Run the build stage with this many builders (2 to 4); 1 means a single builder. */
  fanout: z.number().int().min(1).max(4).default(1),
});
export type CreateTask = z.infer<typeof CreateTask>;

export const AutomationView = z.object({
  id: z.string(),
  cron: z.string(),
  project: z.string(),
  role: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  /** False when the cron expression cannot be parsed. */
  valid: z.boolean(),
  lastFiredAt: z.string().nullable(),
  nextRun: z.string().nullable(),
});
export type AutomationView = z.infer<typeof AutomationView>;

export const AppSettings = z.object({
  theme: z.enum(["system", "light", "dark"]),
  accent: z.string(),
  density: z.enum(["compact", "comfortable"]),
  zoom: z.number(),
  sidebarCollapsed: z.boolean(),
  sessionMode: z.enum(["chat", "terminal"]),
  quietHours: z.object({ from: z.string(), to: z.string() }).nullable(),
  editorCommand: z.string(),
  artVaultRoot: z.string(),
});
export type AppSettings = z.infer<typeof AppSettings>;

export const AppSettingsPatch = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #3b6fd4")
    .optional(),
  density: z.enum(["compact", "comfortable"]).optional(),
  zoom: z.number().int().min(80).max(150).optional(),
  sidebarCollapsed: z.boolean().optional(),
  sessionMode: z.enum(["chat", "terminal"]).optional(),
  quietHours: z
    .object({
      from: z.string().regex(/^\d{2}:\d{2}$/),
      to: z.string().regex(/^\d{2}:\d{2}$/),
    })
    .nullable()
    .optional(),
  editorCommand: z.string().min(1).optional(),
  /** An empty string clears the folder. */
  artVaultRoot: z.string().optional(),
});
export type AppSettingsPatch = z.infer<typeof AppSettingsPatch>;

export const NotificationRules = z.object({
  urgent: z.array(z.string()).optional(),
  mutedProjects: z.array(z.string()).optional(),
  /** An empty string clears the topic. */
  ntfyTopicUrl: z.string().optional(),
});
export type NotificationRules = z.infer<typeof NotificationRules>;

export const ModuleInfo = z.object({
  name: z.string(),
  kind: z.string().nullable(),
  description: z.string(),
  enabled: z.boolean(),
  loaded: z.boolean(),
  error: z.string().optional(),
});
export type ModuleInfo = z.infer<typeof ModuleInfo>;

export const PreviewState = z.object({
  open: z.boolean(),
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  loading: z.boolean(),
  error: z.string().nullable(),
});
export type PreviewState = z.infer<typeof PreviewState>;

export const PreviewBounds = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  visible: z.boolean(),
});
export type PreviewBounds = z.infer<typeof PreviewBounds>;

export const UpdateStatus = z.object({
  version: z.string(),
  /** False for development runs and anything not installed from a release. */
  enabled: z.boolean(),
  state: z.enum([
    "disabled",
    "idle",
    "checking",
    "available",
    "downloading",
    "downloaded",
    "up-to-date",
    "error",
  ]),
  newVersion: z.string().nullable(),
  detail: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;
