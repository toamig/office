import type { ChannelName } from "./ipc";

/**
 * The channels that only read. A read answers from memory or the local database (or a small file read) and
 * never starts a program: anything slower is done by a background job that stores its result. A unit test
 * times every one of these against the fixtures.
 */
export const READ_CHANNELS: readonly ChannelName[] = [
  "app.ping",
  "workspace.get",
  "projects.list",
  "projects.get",
  "vault.openItems",
  "vault.waiting",
  "projects.runs",
  "projects.unrealFile",
  "notes.read",
  "search.items",
  "setup.detectTools",
  "setup.state",
  "setup.inspect",
  "setup.inventory",
  "providers.list",
  "sessions.list",
  "sessions.get",
  "sessions.history",
  "layout.get",
  "dock.get",
  "dock.list",
  "hooks.status",
  "hooks.preview",
  "ask.result",
  "vault.readFile",
  "vault.audit",
  "brief.latest",
  "explore.list",
  "branches.list",
  "branches.compare",
  "worktrees.list",
  "diff.get",
  "git.status",
  "github.overview",
  "chat.state",
  "chat.history",
  "chat.files",
  "permissions.list",
  "app.chrome",
  "automations.list",
  "settings.get",
  "modules.list",
  "preview.state",
  "preview.detect",
  "app.update.status",
  "tasks.list",
  "tasks.get",
  "pending.list",
  "git.graph",
  "git.show",
  "vault.health",
  "health.changes",
  "notes.list",
];

/**
 * Calls that change nothing a view shows (window and pane plumbing, layouts, a chat message whose reply comes
 * as events), so they do not make the screens ask again.
 */
const QUIET_PREFIXES = [
  "onboarding.scan",
  "onboarding.plan",
  "pointer.preview",
  "app.",
  "preview.",
  "layout.",
  "dock.",
  "chat.send",
  "setup.pickFolder",
];

const READS = new Set<string>(READ_CHANNELS);

/** True for a call that may have changed data some open view shows: the cache revalidates after it. */
export function isMutation(channel: string): boolean {
  if (READS.has(channel)) return false;
  return !QUIET_PREFIXES.some((p) => channel.startsWith(p));
}
