import { z } from "zod";
import { AutonomyLevel } from "./autonomy";
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

export const BackgroundRun = z.object({
  id: z.string(), title: z.string(), status: z.enum(["running", "stopping", "stopped"]),
  startedAt: z.string(), endedAt: z.string().nullable(),
});
export type BackgroundRun = z.infer<typeof BackgroundRun>;

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
  /** Files in a merge conflict. */
  conflicted: z.number(),
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

/** One finding of the brain's check, in the words the tool used, and where it is. */
export const HealthProblem = z.object({
  level: z.enum(["error", "warning"]),
  message: z.string(),
  /** The note it is about ("Polyglyph/Pricing.md"), when the message names one. */
  file: z.string().nullable(),
  /** The repo folder it is in ("Polyglyph"), or null for the hub itself. */
  repo: z.string().nullable(),
});
export type HealthProblem = z.infer<typeof HealthProblem>;

export const HealthView = z.object({
  validate: z.object({
    ran: z.boolean(),
    ok: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.number(),
    summary: z.string().nullable(),
    /** Every finding, errors first. */
    problems: z.array(HealthProblem),
    /** The tool's own words, for Show details. */
    output: z.string(),
  }),
  repos: z.array(HubRepoRow),
  warnings: z.array(z.object({ at: z.string(), message: z.string() })),
  /** When the brain was last checked (a background job does it); null until the first check. */
  checkedAt: z.string().nullable(),
});
export type HealthView = z.infer<typeof HealthView>;

export const WriteResult = z.object({
  committed: z.boolean(),
  commit: z.string().optional(),
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

export const RequestResult = z.object({ message: z.string(), link: NotificationLink });
export type RequestResult = z.infer<typeof RequestResult>;

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
/** Something that waits on the owner, derived from live state: it exists exactly while it is unresolved. */
export const PendingItem = z.object({
  /** Stable while the same thing is pending, e.g. "session:<id>". */
  key: z.string(),
  kind: z.enum([
    "permission",
    "agent-needs-you",
    "agent-failed",
    "task-gate",
    "task-failed",
    "conflict",
    "push-failed",
    "ci-failed",
    "review-requested",
    "waiting",
    "save-proposal",
    "workflow",
    "rule-update",
  ]),
  /** danger (red) for something broken, attention (amber) for something that waits for an answer. */
  severity: z.enum(["danger", "attention"]),
  projectId: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  /** Where it is resolved. */
  link: NotificationLink,
  /** Changes when the state behind the item changes, so a dismissed item comes back. */
  fingerprint: z.string(),
  /** For a waiting line: what ticking it off needs. */
  waitingRaw: z.string().optional(),
  proposalId: z.string().optional(),
  workflowResultId: z.string().optional(),
});
export type PendingItem = z.infer<typeof PendingItem>;

export const RecordedNote = z.object({
  id: z.string(),
  path: z.string(),
  summary: z.string(),
});
export type RecordedNote = z.infer<typeof RecordedNote>;

export const WrapUpResult = z.object({
  saved: z.number(),
  proposed: z.number(),
  error: z.string().optional(),
  stopped: z.boolean().optional(),
});
export type WrapUpResult = z.infer<typeof WrapUpResult>;

/** A problem Office shows, as it is handed to Fix in a session. */
export const FixSubject = z.discriminatedUnion("type", [
  /** A pending item, by its key: Office gathers what it knows about that kind of problem. */
  z.object({ type: z.literal("pending"), key: z.string() }),
  /** A finding of the brain's check. */
  z.object({
    type: z.literal("validate"),
    message: z.string(),
    file: z.string().nullable(),
    repo: z.string().nullable(),
  }),
  /** A brain repo that needs attention. */
  z.object({ type: z.literal("repo"), folder: z.string(), state: z.string() }),
  z.object({ type: z.literal("audit"), repo: z.string(), entry: z.string() }),
  z.object({ type: z.literal("warning"), message: z.string() }),
  /** An error pop-up that has a project or a folder. */
  z.object({
    type: z.literal("error"),
    title: z.string(),
    cause: z.string(),
    projectId: z.string().optional(),
    folder: z.string().optional(),
  }),
  /** Any other problem (a Setup or project problem without a button of its own). */
  z.object({
    type: z.literal("problem"),
    key: z.string(),
    title: z.string(),
    detail: z.string(),
    projectId: z.string().optional(),
    folder: z.string().optional(),
  }),
]);
export type FixSubject = z.infer<typeof FixSubject>;

/** A problem that is being fixed in a session, by the key the problem has on screen. */
export const FixEntry = z.object({ key: z.string(), sessionId: z.string(), title: z.string() });
export type FixEntry = z.infer<typeof FixEntry>;

export const AgentInteraction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), questions: z.array(z.object({
    question: z.string().min(1), header: z.string().optional(), multiSelect: z.boolean().default(false),
    options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })),
  })).min(1) }),
  z.object({ kind: z.literal("plan"), plan: z.string() }),
]);
export type AgentInteraction = z.infer<typeof AgentInteraction>;

export const InteractionAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), answers: z.array(z.object({ choices: z.array(z.string()), other: z.string().optional() })) }),
  z.object({ kind: z.literal("plan"), approve: z.boolean(), reason: z.string().optional() }),
]);
export type InteractionAnswer = z.infer<typeof InteractionAnswer>;

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
  interaction: AgentInteraction.optional(),
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
  /** The note's own one-line summary, from its frontmatter. */
  summary: z.string().nullable(),
  /** Where the note lives in the brain, for the Source line ("Alpha/Overview.md"). */
  source: z.string(),
});
export type ProjectNote = z.infer<typeof ProjectNote>;

/** A note of a project, for the list beside the document. */
export const NoteEntry = z.object({
  name: z.string(),
  summary: z.string().nullable(),
  /** Audits and implementation notes: behind Show more. */
  rare: z.boolean(),
});
export type NoteEntry = z.infer<typeof NoteEntry>;

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

/** One step of the welcome flow. */
export const SetupStep = z.object({
  id: z.enum(["workspace", "projects", "tools", "add", "instructions", "notifications"]),
  label: z.string(),
  /** A required step has to be met before the app opens; the notification step is optional. */
  required: z.boolean(),
  met: z.boolean(),
  /** One line saying what is missing, null when the step is met. */
  reason: z.string().nullable(),
});
export type SetupStep = z.infer<typeof SetupStep>;

export const SetupState = z.object({
  /** True while Office shows only the welcome flow: it was never finished, or a required step broke. */
  welcome: z.boolean(),
  steps: z.array(SetupStep),
  /** The step to open on: the first required one that is not met, else the tools step (the first one the owner confirms). */
  current: SetupStep.shape.id,
});
export type SetupState = z.infer<typeof SetupState>;

/** Which of the workspace's projects exist under a candidate projects folder. */
export const FolderScan = z.object({
  total: z.number(),
  found: z.array(z.string()),
  missing: z.array(z.string()),
});
export type FolderScan = z.infer<typeof FolderScan>;

export const RootSuggestion = z.object({
  /** The best folder, or null when none of the places looked at holds any of the projects. */
  best: z.string().nullable(),
  total: z.number(),
  candidates: z.array(z.object({ path: z.string(), found: z.number(), total: z.number() })),
});
export type RootSuggestion = z.infer<typeof RootSuggestion>;

/** A code repo found under the projects folder that is not in the workspace yet. */
export const ScanCandidate = z.object({
  path: z.string(),
  name: z.string(),
  remote: z.string().nullable(),
  lastCommit: z.string().nullable(),
  group: z.string(),
  notes: z.string().nullable(),
});
export type ScanCandidate = z.infer<typeof ScanCandidate>;

export const OnboardingItem = z.object({
  path: z.string(),
  name: z.string().min(1),
  group: z.string().optional(),
  notes: z.enum(["new", "link", "none"]),
  linkFolder: z.string().optional(),
  hub: z.enum(["repo", "folder"]).optional(),
  hubFolder: z.string().optional(),
  domain: z.enum(["ue5", "saas", "webgames", "mobile", "meta"]).default("saas"),
});
export type OnboardingItem = z.infer<typeof OnboardingItem>;

export const OnboardingReport = z.object({
  ok: z.boolean(),
  steps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(["done", "failed", "pending"]),
      result: z.string().optional(),
    }),
  ),
  added: z.array(z.string()),
});
export type OnboardingReport = z.infer<typeof OnboardingReport>;

export const BrainResult = z.object({
  path: z.string(),
  configPath: z.string(),
  files: z.array(z.string()),
  github: z.object({
    requested: z.boolean(),
    repo: z.string().optional(),
    error: z.string().optional(),
  }),
});
export type BrainResult = z.infer<typeof BrainResult>;

export const PointerTarget = z.enum(["agents", "local"]);
export type PointerTarget = z.infer<typeof PointerTarget>;

export const PointerPreview = z.object({
  project: z.string(),
  /** The file the block goes in by default for this repo (see `target`). */
  file: z.string(),
  text: z.string(),
  /** The files each choice would create, when they do not exist yet. */
  creates: z.object({ agents: z.array(z.string()), local: z.array(z.string()) }),
  installed: z.boolean(),
  /** Where it goes by default: the local file for a public repo, AGENTS.md otherwise or when GitHub cannot say. */
  target: PointerTarget,
  /** What `gh repo view` said ("PUBLIC", "PRIVATE", "INTERNAL"), or null when it could not say. */
  visibility: z.string().nullable(),
});
export type PointerPreview = z.infer<typeof PointerPreview>;

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

export const ChatImageSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  z.object({ kind: z.literal("attachment"), messageId: z.uuid(), index: z.number().int().nonnegative() }),
]);
export type ChatImageSource = z.infer<typeof ChatImageSource>;

export const ChatFile = z.object({
  name: z.string(), kind: z.enum(["markdown", "html", "image", "pdf", "text", "binary"]),
  text: z.string().optional(),
});
export type ChatFile = z.infer<typeof ChatFile>;

/**
 * What a chat shows, one event at a time, whichever program is underneath. The main process turns the
 * provider's stream into these, stores them as JSON lines in the session's folder, and sends them to the
 * chat view; the view builds its messages from them with the reducer in shared/chat.ts.
 */
export const OfficeBrief = z.object({ title: z.string(), where: z.string(), done: z.string() });
export type OfficeBrief = z.infer<typeof OfficeBrief>;

const PlanStep = z.object({ text: z.string(), status: z.enum(["completed", "in_progress", "pending"]) });
export type PlanStep = z.infer<typeof PlanStep>;

export const QueuedMessage = z.object({ id: z.string(), text: z.string(), images: z.number() });
export type QueuedMessage = z.infer<typeof QueuedMessage>;

export const RewindPreview = z.object({
  revision: z.string(),
  omitted: z.array(z.string()),
  files: z.array(z.object({ path: z.string(), action: z.enum(["create", "modify", "delete"]) })),
});
export type RewindPreview = z.infer<typeof RewindPreview>;

export const ChatEvent = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("user"),
    id: z.string(),
    text: z.string(),
    images: z.number().default(0),
    brief: OfficeBrief.optional(),
  }),
  QueuedMessage.extend({ t: z.literal("queued") }),
  z.object({ t: z.literal("queue-remove"), id: z.string() }),
  z.object({ t: z.literal("turn-start") }),
  z.object({ t: z.literal("commands"), names: z.array(z.string()) }),
  z.object({ t: z.literal("interaction"), id: z.string(), requestId: z.string(), interaction: AgentInteraction }),
  z.object({ t: z.literal("interaction-result"), id: z.string(), answer: InteractionAnswer.optional() }),
  z.object({ t: z.literal("cleared") }),
  z.object({ t: z.literal("snapshot"), id: z.string() }),
  z.object({ t: z.literal("rewound"), id: z.string() }),
  z.object({ t: z.literal("rewind-notified") }),
  z.object({ t: z.literal("plan"), id: z.string(), steps: z.array(PlanStep) }),
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
  z.object({
    t: z.literal("subagent"),
    id: z.string(),
    task: z.string().optional(),
    progress: z.string().optional(),
    verdict: z.string().optional(),
    status: z.enum(["working", "done", "error"]),
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
  z.object({ t: z.literal("stopped"), detail: z.string().optional() }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;

/** A stored or live chat event with its place in the conversation. */
export const ChatLine = z.object({ seq: z.number(), at: z.string(), event: ChatEvent });
export type ChatLine = z.infer<typeof ChatLine>;

/** What the chat's header lets the owner choose. */
export const ChatOptions = z.object({
  model: z.string().optional(),
  effort: z.enum(["", "none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
});
export type ChatOptions = z.infer<typeof ChatOptions>;

export const ChatModel = z.object({ id: z.string(), label: z.string(), efforts: z.array(z.string()) });
export type ChatModel = z.infer<typeof ChatModel>;

export const ChatState = z.object({
  mode: SessionMode,
  /** "claude" runs one process per chat; "codex" runs one per turn in a sandbox. */
  kind: z.enum(["claude", "codex"]),
  /** True while a turn runs. */
  working: z.boolean(),
  models: z.array(ChatModel),
  defaultModel: ChatModel.optional(),
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
  autonomy: AutonomyLevel.optional(),
  brainRoot: z.string().optional(),
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
  activity: z.string().optional(),
  /** Whether the session is a chat or a terminal. Sessions made before chats existed are terminals. */
  mode: SessionMode,
  /** True once a process for the provider conversation has run, so resuming it is possible. */
  conversationStarted: z.boolean(),
  /** Finished and unused for longer than the idle time, so Office asks whether it is still needed. */
  idle: z.boolean(),
  /** A chat that keeps nothing once closed: it is never listed, and exists only while it is open. */
  incognito: z.boolean(),
  /** A chat that is not archived for being idle. */
  pinned: z.boolean(),
});
export type SessionRow = z.infer<typeof SessionRow>;

export const StartSession = z.object({
  /** A role id from the workspace config; its provider, model and instructions are used. */
  roleId: z.string().optional(),
  /** Used when no role is given. */
  providerId: z.string().optional(),
  model: z.string().optional(),
  autonomy: AutonomyLevel.optional(),
  projectId: z.string().optional(),
  /** Folder to run in; defaults to the project folder. */
  cwd: z.string().optional(),
  title: z.string().optional(),
  prompt: z.string().optional(),
  brief: OfficeBrief.optional(),
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

/** One plain line of the brief, with the place it points to. */
export const BriefLine = z.object({ text: z.string(), link: NotificationLink });
export type BriefLine = z.infer<typeof BriefLine>;

export const BriefView = z.object({
  /** Local date (YYYY-MM-DD) of the newest brief, or null when none was written yet. */
  date: z.string().nullable(),
  /** Three to five plain lines: what changed, what needs you, what is worth doing next. */
  lines: z.array(BriefLine),
  /** The facts the lines were written from, grouped by project (Show details). */
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

/** A name on a commit of the graph: a branch, a remote branch, a tag, or HEAD when it is detached. */
export const GraphLabel = z.object({
  kind: z.enum(["branch", "remote", "tag", "head"]),
  name: z.string(),
  /** The checked-out branch (or the detached HEAD). */
  current: z.boolean(),
});
export type GraphLabel = z.infer<typeof GraphLabel>;

/** A segment of a lane, with the colour index of the branch it belongs to. */
const GraphSegment = z.object({ lane: z.number(), color: z.number() });

/** One commit of the graph and the lines around it: which lanes arrive, pass by and leave. */
export const GraphRow = z.object({
  hash: z.string(),
  short: z.string(),
  subject: z.string(),
  author: z.string(),
  /** Unix seconds. */
  at: z.number(),
  parents: z.array(z.string()),
  /** The lane of the commit's dot, and the colour index of its branch. */
  col: z.number(),
  color: z.number(),
  /** Lanes that end at this commit from above (more than one is a fork: branches that started here). */
  fromAbove: z.array(GraphSegment),
  /** Lanes that pass by this row without touching the commit. */
  through: z.array(GraphSegment),
  /** Where each parent's line goes below the commit (more than one is a merge). */
  toBelow: z.array(z.object({ to: z.number(), color: z.number() })),
  labels: z.array(GraphLabel),
});
export type GraphRow = z.infer<typeof GraphRow>;

export const GraphView = z.object({
  rows: z.array(GraphRow),
  /** The most lanes any row has: the width of the drawing. */
  width: z.number(),
  hasMore: z.boolean(),
  /** The commit HEAD is on (when it is among those shown) and its branch (null when detached). */
  head: z.object({ hash: z.string().nullable(), branch: z.string().nullable() }),
  detached: z.boolean(),
});
export type GraphView = z.infer<typeof GraphView>;

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
  workflowDatabaseId: z.number().int().optional(),
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
  status: z.enum(["running", "done", "failed", "cancelled", "kept", "discarded"]),
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
    "cancelled",
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

export const AppSettings = z.object({
  theme: z.enum(["system", "light", "dark"]),
  accent: z.string(),
  density: z.enum(["compact", "comfortable"]),
  zoom: z.number(),
  sidebarCollapsed: z.boolean(),
  sidebarWidth: z.number(),
  inspectorWidth: z.number(),
  inspectorHidden: z.record(z.string(), z.boolean()),
  panes: z.record(z.string(), z.number()),
  sessionMode: z.enum(["chat", "terminal"]),
  autonomy: AutonomyLevel,
  confirmedFullAuto: z.boolean(),
  briefEnabled: z.boolean(),
  briefModel: z.string(),
  briefTime: z.string(),
  recorderEnabled: z.boolean(),
  recorderModel: z.string(),
  recorderIdleMinutes: z.number(),
  learningEnabled: z.boolean(),
  requestRouterEnabled: z.boolean(),
  requestRouterModel: z.string(),
  sessionIdleDays: z.number(),
  sessionsMulti: z.boolean(),
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
  sidebarWidth: z.number().int().min(200).max(320).optional(),
  inspectorWidth: z.number().int().min(280).max(480).optional(),
  /** Views to show or hide the inspector in, by view id; merged into the saved ones. */
  inspectorHidden: z.record(z.string(), z.boolean()).optional(),
  /** Divider positions to remember, by pane id; they are merged into the saved ones. */
  panes: z.record(z.string(), z.number()).optional(),
  sessionMode: z.enum(["chat", "terminal"]).optional(),
  autonomy: AutonomyLevel.optional(),
  confirmedFullAuto: z.literal(true).optional(),
  briefEnabled: z.boolean().optional(),
  briefModel: z.string().max(120).optional(),
  briefTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  recorderEnabled: z.boolean().optional(),
  recorderModel: z.string().max(120).optional(),
  recorderIdleMinutes: z.number().int().min(1).max(120).optional(),
  learningEnabled: z.boolean().optional(),
  requestRouterEnabled: z.boolean().optional(),
  requestRouterModel: z.string().max(120).optional(),
  sessionIdleDays: z.number().int().min(1).max(60).optional(),
  sessionsMulti: z.boolean().optional(),
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
    /** Nothing has been published on GitHub yet: a neutral state, not a failure. */
    "no-releases",
    "error",
  ]),
  newVersion: z.string().nullable(),
  detail: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;
