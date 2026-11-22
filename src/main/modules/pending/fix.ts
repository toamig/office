import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixKeyOf } from "../../../shared/fix";
import type {
  FixEntry,
  FixSubject,
  OfficeBrief,
  PendingItem,
  RunInfo,
  SessionRow,
} from "../../../shared/models";
import type { Bus } from "../../core/bus";
import type { Db } from "../../core/db";
import { IpcFailure } from "../../core/ipc";
import { nowIso } from "../../core/util";
import {
  buildFixBrief,
  failedRunDetails,
  filesFromText,
  fixTitle,
  runIdOf,
  type FixFacts,
} from "./fix-brief";

/** What Fix in a session needs from the rest of the app; each is small so a test can stand in for it. */
export interface FixDeps {
  db: Db;
  bus: Bus;
  /** Every pending item, including the ones the owner dismissed. */
  findPending: (key: string) => PendingItem | undefined;
  /** The last finished CI run of a project when it failed (from the last GitHub poll). */
  failedRun: (projectId: string) => RunInfo | null;
  /** The code folder of a project, or undefined. */
  projectDir: (projectId: string) => string | undefined;
  projectName: (projectId: string) => string;
  /** The brain's folder (the hub root). */
  workspaceRoot: () => string;
  /** A session by id, and the tail of what it said (a chat's last words, a terminal's last output). */
  session: (id: string) => SessionRow | undefined;
  sessionTail: (id: string) => string;
  /** A failed task: its failing stage's error and output, and its folder. */
  task: (
    id: string,
  ) =>
    { title: string; stage: string; error: string; output: string; dir: string | null } | undefined;
  /** Runs a command in a folder and returns its output (gh and git); never throws. */
  exec: (
    cmd: string,
    args: string[],
    cwd: string,
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Starts the chat session, with the first message already sent. */
  startSession: (input: {
    providerId: string;
    projectId?: string;
    cwd: string;
    title: string;
    prompt: string;
    brief?: OfficeBrief;
  }) => SessionRow;
}

export interface FixPlan {
  /** The goal: "Fix: ...". */
  title: string;
  /** The folder where the problem lives. */
  folder: string;
  projectId?: string;
  /** The first message. */
  brief: string;
  briefMeta: OfficeBrief;
  /** How the problem is tracked while it is being fixed. */
  key: string;
}

const tail = (text: string, max = 4000): string =>
  text.length > max ? `...${text.slice(-max)}` : text;

/**
 * Fix in a session: one click starts a chat at once, in the folder where the problem lives, with the goal "Fix: ..."
 * and a first message holding everything Office knows (what failed and where, the exact error, the files, what done
 * means). The problem then shows "Being fixed in <session>" and goes away when its state clears, not when the
 * session is wrapped up.
 */
export class FixService {
  constructor(private readonly deps: FixDeps) {}

  /** What to start for a problem: its goal, its folder, its first message and the key it is tracked by. */
  async plan(subject: FixSubject): Promise<FixPlan> {
    const { deps } = this;
    const hub = deps.workspaceRoot();
    const repoFolder = (repo: string | null): string =>
      repo && repo !== "." && repo !== "hub" ? join(hub, repo) : hub;
    let key: string;
    let title: string;
    let folder: string;
    let projectId: string | undefined;
    let facts: FixFacts;
    switch (subject.type) {
      case "pending": {
        const item = deps.findPending(subject.key);
        if (!item)
          throw new IpcFailure(
            "gone",
            "That problem is no longer there, so there is nothing to fix",
          );
        key = fixKeyOf(subject);
        projectId = item.projectId ?? undefined;
        const got = await this.pendingFacts(item);
        title = got.title;
        folder = got.folder;
        facts = got.facts;
        break;
      }
      case "validate":
        key = fixKeyOf(subject);
        title = fixTitle(subject.message);
        folder = repoFolder(subject.repo);
        facts = {
          what: `The brain's own check reports a problem${subject.file ? ` in ${subject.file}` : ""}.`,
          where: `The brain repo ${subject.repo ?? "hub"} (${folder}). The check is: node Common/tools/brain.mjs validate, run from the hub root.`,
          output: subject.message,
          files: subject.file ? [subject.file] : [],
          done: "the brain's check no longer reports this problem, and the change is committed.",
        };
        break;
      case "repo":
        key = fixKeyOf(subject);
        title = fixTitle(`${subject.folder === "." ? "the hub" : subject.folder} needs attention`);
        folder = repoFolder(subject.folder);
        facts = {
          what: `The brain repo ${subject.folder === "." ? "hub" : subject.folder} needs attention.`,
          where: folder,
          output: `State: ${subject.state}`,
          done: "git status shows nothing to commit, and nothing to push or pull.",
        };
        break;
      case "audit":
        key = fixKeyOf(subject);
        title = fixTitle(subject.entry);
        folder = repoFolder(subject.repo);
        facts = {
          what: "An open entry of the content audit.",
          where: `The content audit of ${subject.repo} (${folder}/_ContentAudit.md).`,
          output: subject.entry,
          done: "the entry is resolved, removed from the audit, and the change is committed.",
        };
        break;
      case "warning":
        key = fixKeyOf(subject);
        title = fixTitle(subject.message);
        folder = hub;
        facts = {
          what: "A brain write needs attention.",
          where: hub,
          output: subject.message,
          done: "the cause is fixed, and the brain is committed and pushed.",
        };
        break;
      case "error":
        key = fixKeyOf(subject);
        projectId = subject.projectId;
        title = fixTitle(subject.title);
        folder = this.folderFor(subject.projectId, subject.folder);
        facts = {
          what: subject.title,
          where: subject.projectId
            ? `The project ${deps.projectName(subject.projectId)} (${folder}).`
            : folder,
          output: subject.cause,
          done: "the action that failed works when it is tried again.",
        };
        break;
      case "problem":
        key = fixKeyOf(subject);
        projectId = subject.projectId;
        title = fixTitle(subject.title);
        folder = this.folderFor(subject.projectId, subject.folder);
        facts = {
          what: subject.title,
          where: subject.projectId
            ? `The project ${deps.projectName(subject.projectId)} (${folder}).`
            : folder,
          output: subject.detail,
          done: "the problem is gone: whatever showed it no longer does.",
        };
        break;
    }
    if (!existsSync(folder))
      throw new IpcFailure("no-folder", `The folder for this problem is not there: ${folder}`);
    return { title, folder, ...(projectId ? { projectId } : {}), brief: buildFixBrief(facts),
      briefMeta: { title: facts.what, where: facts.where, done: facts.done }, key };
  }

  private folderFor(projectId: string | undefined, folder: string | undefined): string {
    const dir = projectId ? this.deps.projectDir(projectId) : undefined;
    return folder ?? dir ?? this.deps.workspaceRoot();
  }

  /** The facts of each kind of pending problem. */
  private async pendingFacts(
    item: PendingItem,
  ): Promise<{ title: string; folder: string; facts: FixFacts }> {
    const { deps } = this;
    const project = item.projectId ? deps.projectName(item.projectId) : "";
    const dir = item.projectId ? deps.projectDir(item.projectId) : undefined;
    const hubDir = deps.workspaceRoot();
    switch (item.kind) {
      case "ci-failed": {
        const run = item.projectId ? deps.failedRun(item.projectId) : null;
        if (!item.projectId || !dir)
          throw new IpcFailure("no-folder", "Office does not know where this project lives");
        const id = run ? runIdOf(run.url) : null;
        const { step, text: output } = id
          ? await failedRunDetails(deps.exec, id, dir)
          : { step: null, text: "" };
        const branch = run?.headBranch || "the branch";
        return {
          title: fixTitle(`CI failed in ${project}`),
          folder: dir,
          facts: {
            what: `CI failed in ${project}: ${run?.name ?? "a run"} on ${branch}${step ? `, in the step ${step}` : ""}.`,
            where: `${dir}${run ? `. The run: ${run.url}` : ""}`,
            output,
            files: filesFromText(output),
            done: `CI is green on ${branch}.`,
          },
        };
      }
      case "conflict": {
        const folder = item.key.startsWith("conflict:hub:") ? hubDir : (dir ?? hubDir);
        const conflicted = await deps.exec(
          "git",
          ["diff", "--name-only", "--diff-filter=U"],
          folder,
        );
        const files = conflicted.stdout.split(/\r?\n/).filter(Boolean);
        return {
          title: fixTitle(`merge conflict in ${project || "the repo"}`),
          folder,
          facts: {
            what: `${item.title}.`,
            where: folder,
            output: item.detail ?? "",
            files,
            done: "the conflict is resolved and committed, and git status is clean.",
          },
        };
      }
      case "push-failed":
        return {
          title: fixTitle(`push failed in ${project || "the brain"}`),
          folder: dir ?? hubDir,
          facts: {
            what: `${item.title}.`,
            where: dir ?? hubDir,
            output: item.detail ?? "",
            done: "the branch is pushed to its remote and git status shows nothing left to push.",
          },
        };
      case "agent-failed": {
        const id = item.key.replace(/^session:/, "");
        const session = deps.session(id);
        return {
          title: fixTitle(`${session?.title ?? "a session"} failed`),
          folder: session?.cwd ?? dir ?? hubDir,
          facts: {
            what: `The session "${session?.title ?? id}" failed.`,
            where: `${session?.cwd ?? dir ?? hubDir}${session?.branch ? ` on the branch ${session.branch}` : ""}${project ? `, in the project ${project}` : ""}.`,
            output: tail(deps.sessionTail(id)),
            files: filesFromText(deps.sessionTail(id)),
            done: "the cause of the failure is fixed, so that session's work can run again.",
          },
        };
      }
      case "task-failed": {
        const id = item.key.replace(/^task:/, "");
        const task = deps.task(id);
        const output = task ? `${task.error}\n${task.output}`.trim() : "";
        return {
          title: fixTitle(`${task?.title ?? item.title} failed`),
          folder: task?.dir ?? dir ?? hubDir,
          facts: {
            what: `The task "${task?.title ?? item.title}" failed${task ? ` in the stage ${task.stage}` : ""}.`,
            where: `${task?.dir ?? dir ?? hubDir}${project ? `, in the project ${project}` : ""}.`,
            output: tail(output),
            files: filesFromText(output),
            done: "the cause of the failure is fixed, so the task can be retried and gets past that stage.",
          },
        };
      }
      default:
        return {
          title: fixTitle(item.title),
          folder: dir ?? hubDir,
          facts: {
            what: `${item.title}.`,
            where: dir ?? hubDir,
            output: item.detail ?? "",
            done: "the problem is gone: whatever showed it no longer does.",
          },
        };
    }
  }

  /** Starts the Fix session for a problem and remembers which problem it is for. */
  async start(subject: FixSubject, providerId: string): Promise<SessionRow> {
    const plan = await this.plan(subject);
    const existing = this.entryFor(plan.key);
    if (existing) {
      const live = this.deps.session(existing.sessionId);
      if (live && !live.archivedAt) return live;
    }
    const session = this.deps.startSession({
      providerId,
      ...(plan.projectId ? { projectId: plan.projectId } : {}),
      cwd: plan.folder,
      title: plan.title,
      prompt: plan.brief,
      brief: plan.briefMeta,
    });
    this.deps.db
      .prepare(
        `INSERT INTO fixes (key, session_id, started_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, started_at = excluded.started_at`,
      )
      .run(plan.key, session.id, nowIso());
    this.deps.bus.emit("fix.changed", { key: plan.key });
    return session;
  }

  private entryFor(key: string): { sessionId: string } | undefined {
    const row = this.deps.db.prepare("SELECT session_id FROM fixes WHERE key = ?").get(key) as
      { session_id: string } | undefined;
    return row ? { sessionId: row.session_id } : undefined;
  }

  /** The problems that have a session fixing them, while that session is open. */
  list(): FixEntry[] {
    const rows = this.deps.db.prepare("SELECT key, session_id FROM fixes").all() as Array<{
      key: string;
      session_id: string;
    }>;
    const out: FixEntry[] = [];
    for (const r of rows) {
      const s = this.deps.session(r.session_id);
      if (s && !s.archivedAt)
        out.push({ key: r.key, sessionId: s.id, title: s.title ?? "a session" });
    }
    return out;
  }
}
