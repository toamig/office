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
