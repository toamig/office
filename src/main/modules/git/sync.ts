import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SyncAction, SyncRepoResult } from "../../../shared/models";
import { git } from "./run";
import { readStatus } from "./status";

const NETWORK_TIMEOUT_MS = 60_000;

export interface RepoOutcome {
  action: SyncAction;
  reason?: string;
  pushFailed?: boolean;
}

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

/** True while a rebase or merge is half-done in the repo. */
export async function operationInProgress(path: string): Promise<boolean> {
  const result = await git(path, ["rev-parse", "--absolute-git-dir"]);
  if (result.code !== 0) return false;
  const dir = result.stdout.trim();
  return ["rebase-merge", "rebase-apply", "MERGE_HEAD"].some((name) => existsSync(join(dir, name)));
}

async function lines(path: string, args: string[]): Promise<string[]> {
  const result = await git(path, args);
  return result.code === 0 ? result.stdout.split("\n").filter(Boolean) : [];
}

/**
 * Brings one repo in step with its upstream: fetch, pull --rebase when behind, push when ahead.
 * Never merges a conflict: a failed rebase is aborted and reported, and nothing is left mid-rebase.
 */
export async function syncRepo(path: string): Promise<RepoOutcome> {
  const first = await readStatus(path);
  if (!first.ok) return { action: "failed", reason: firstLine(first.error) };
  const start = first.status;
  if (start.detached) return { action: "skipped", reason: "detached HEAD" };
  if (!start.upstream) return { action: "skipped", reason: "no upstream branch" };
  if (start.conflicted > 0)
    return { action: "skipped", reason: "unresolved conflicts in the working tree" };
  if (await operationInProgress(path)) {
    return { action: "skipped", reason: "a rebase or merge is already in progress" };
  }

  const fetch = await git(path, ["fetch", "--prune", "--quiet"], { timeoutMs: NETWORK_TIMEOUT_MS });
  if (fetch.code !== 0)
    return { action: "failed", reason: `fetch failed: ${firstLine(fetch.stderr)}` };

  const afterFetch = await readStatus(path);
  if (!afterFetch.ok) return { action: "failed", reason: firstLine(afterFetch.error) };
  let status = afterFetch.status;
  let pulled = false;

  if (status.behind > 0) {
    if (status.files.length > 0) {
      const incoming = new Set(
        await lines(path, ["diff", "--name-only", "--no-renames", "HEAD...@{u}"]),
      );
      const dirty = status.files.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]));
      const overlap = dirty.filter((p) => incoming.has(p));
      if (overlap.length > 0) {
        return {
          action: "skipped",
          reason: `uncommitted changes overlap incoming changes (${overlap.slice(0, 3).join(", ")})`,
        };
      }
    }
    const pull = await git(path, ["pull", "--rebase", "--autostash", "--quiet"], {
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
    if (pull.code !== 0) {
      if (await operationInProgress(path)) {
        await git(path, ["rebase", "--abort"]);
        if (await operationInProgress(path)) {
          return {
            action: "conflict",
            reason: "rebase could not be aborted automatically; check the repo by hand",
          };
        }
        return {
          action: "conflict",
          reason: "local and remote changes conflict; rebase aborted, nothing changed",
        };
      }
      return { action: "failed", reason: `pull failed: ${firstLine(pull.stderr)}` };
    }
    pulled = true;
    const again = await readStatus(path);
    if (again.ok) status = again.status;
  }

  if (status.ahead > 0) {
    if (status.files.length > 0) {
      const reason = `${status.ahead} commit(s) to push, but the working tree has uncommitted changes (${filesNote(status.files.map((f) => f.path))})`;
      return pulled
        ? { action: "pulled", reason: `pulled; ${reason}` }
        : { action: "skipped", reason };
    }
    const push = await git(path, ["push", "--quiet"], { timeoutMs: NETWORK_TIMEOUT_MS });
    if (push.code !== 0) {
      return {
        action: "failed",
        reason: `push failed: ${firstLine(push.stderr)}`,
        pushFailed: true,
      };
    }
    return { action: pulled ? "pulled-and-pushed" : "pushed" };
  }
  return { action: pulled ? "pulled" : "up-to-date" };
}

const HUB_PAD = 26;

/** The first few file names, for a message that says what is in the way. */
export function filesNote(paths: string[], shown = 3): string {
  const head = paths.slice(0, shown).join(", ");
  return paths.length > shown ? `${head} and ${paths.length - shown} more` : head;
}

/** Turns the text printed by `node tools/hub.mjs auto` into one result per nested repo. */
export function parseHubOutput(text: string): SyncRepoResult[] {
  const byFolder = new Map<string, SyncRepoResult>();
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length <= HUB_PAD || raw[HUB_PAD] !== " ") continue;
    const folder = raw.slice(0, HUB_PAD).trim();
    const body = raw.slice(HUB_PAD).trim();
    if (!folder || /\s/.test(folder)) continue;
    const id = `hub:${folder}`;
    const incoming = classifyHubLine(body);
    const existing = byFolder.get(id);
    byFolder.set(
      id,
      existing
        ? mergeResults(existing, incoming)
        : { id, name: folder === "." ? "Brain hub" : folder, ...incoming },
    );
  }
  return [...byFolder.values()];
}

function classifyHubLine(body: string): RepoOutcome {
  if (/^up to date/.test(body)) return { action: "up-to-date" };
  if (/^pulled|^rebased/.test(body)) return { action: "pulled" };
  if (/^pushed/.test(body)) return { action: "pushed" };
  if (/DIVERGED/.test(body)) return { action: "conflict", reason: body };
  if (/^push failed/.test(body)) return { action: "failed", reason: body, pushFailed: true };
  if (/fetch failed|sync failed|missing/.test(body)) return { action: "failed", reason: body };
  return { action: "skipped", reason: body };
}

const rank: Record<SyncAction, number> = {
  conflict: 6,
  failed: 5,
  skipped: 4,
  "pulled-and-pushed": 3,
  pulled: 2,
  pushed: 2,
  "up-to-date": 0,
};

function mergeResults(a: SyncRepoResult, b: RepoOutcome): SyncRepoResult {
  const pair = new Set([a.action, b.action]);
  if (pair.has("pulled") && pair.has("pushed")) return { ...a, action: "pulled-and-pushed" };
  const winner = rank[b.action] > rank[a.action] ? b : a;
  return {
    id: a.id,
    name: a.name,
    action: winner.action,
    ...(winner.reason ? { reason: winner.reason } : {}),
    ...(a.pushFailed || b.pushFailed ? { pushFailed: true } : {}),
  };
}
