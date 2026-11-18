import type { ReviewComment } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import { IpcFailure } from "../../core/ipc";
import { normPath } from "../../core/util";
import type { SessionService } from "./service";

/** One line per comment: `file:line: comment`. */
export function formatComments(comments: ReviewComment[]): string {
  return comments
    .map((c) => `${c.file}:${c.line}: ${c.text.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

/**
 * Sends review comments back to the agent that made the change: into the running session whose folder
 * is that worktree, or into a new builder session started there.
 */
export function sendReviewToAgent(
  deps: { sessions: SessionService; workspace: () => Workspace | null },
  projectId: string,
  cwd: string,
  comments: ReviewComment[],
): { sessionId: string; started: boolean } {
  if (comments.length === 0) throw new IpcFailure("no-comments", "Add at least one comment first");
  const message = formatComments(comments);
  const owner = deps.sessions
    .list({ projectId })
    .find((s) => s.running && s.interactive && normPath(s.cwd) === normPath(cwd));
  if (owner) {
    deps.sessions.sendMessage(owner.id, message);
    return { sessionId: owner.id, started: false };
  }
  const ws = deps.workspace();
  const prompt = `Please address these review comments on the changes in this folder:\n\n${message}`;
  const started = deps.sessions.start(
    ws?.roles["builder"]
      ? { roleId: "builder", projectId, cwd, prompt, title: "Review fixes" }
      : { providerId: "claude-code", projectId, cwd, prompt, title: "Review fixes" },
  );
  return { sessionId: started.id, started: true };
}
