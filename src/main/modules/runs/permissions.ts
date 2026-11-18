import { randomUUID } from "node:crypto";
import type { PermissionRequest } from "../../../shared/models";
import type { Bus } from "../../core/bus";
import type { Db } from "../../core/db";
import type { Notifier } from "../../core/notifier";
import { nowIso } from "../../core/util";

/** What the permission tool answers Claude Code with (plan 9.5). */
export type PermissionDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export interface PermissionBrokerDeps {
  db: Db;
  bus: Bus;
  notifier: Notifier;
  /** Tells the task engine that a run started or stopped waiting for the owner. */
  onWaiting?: (runId: string, waiting: boolean) => void;
}

interface Pending {
  request: PermissionRequest;
  notificationId: string;
  input: Record<string, unknown>;
  resolve: (decision: PermissionDecision) => void;
}

/** A tool's input as one line: the command for Bash, the path for file tools, else the JSON. */
export function summariseToolInput(toolName: string, input: Record<string, unknown>): string {
  const pick = (key: string): string | null =>
    typeof input[key] === "string" ? (input[key] as string) : null;
  const text =
    pick("command") ?? pick("file_path") ?? pick("path") ?? pick("url") ?? JSON.stringify(input);
  const flat = text.replace(/\s+/g, " ").trim();
  const line = toolName === "Bash" ? flat : `${toolName}: ${flat}`;
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

/**
 * Holds the questions headless builders ask ("may I run this?") until the owner answers them in the Inbox
 * or on Home. Allow is for this one request only; "always allow" is not offered (edit the role instead).
 */
export class PermissionBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly deps: PermissionBrokerDeps) {}

  /** What a run is for: its task's title, else its kind. */
  private describe(runId: string): {
    taskId: string | null;
    projectId: string | null;
    subject: string;
  } {
    const run = this.deps.db
      .prepare("SELECT kind, task_id, project_id FROM runs WHERE id = ?")
      .get(runId) as
      { kind: string; task_id: string | null; project_id: string | null } | undefined;
    // A chat's questions use the chat session's id as the run id.
    const chat = run
      ? undefined
      : (this.deps.db.prepare("SELECT title, project_id FROM sessions WHERE id = ?").get(runId) as
          { title: string | null; project_id: string | null } | undefined);
    const task = run?.task_id
      ? (this.deps.db.prepare("SELECT title FROM tasks WHERE id = ?").get(run.task_id) as
          { title: string } | undefined)
      : undefined;
    return {
      taskId: run?.task_id ?? null,
      projectId: run?.project_id ?? chat?.project_id ?? null,
      subject: task?.title ?? chat?.title ?? run?.kind ?? "A run",
    };
  }

  /** The question arrives; the returned promise settles when the owner answers or the run goes away. */
  request(
    runId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> {
    const toolName = typeof body["tool_name"] === "string" ? body["tool_name"] : "a tool";
    const input =
      body["input"] && typeof body["input"] === "object"
        ? (body["input"] as Record<string, unknown>)
        : {};
    const about = this.describe(runId);
    const summary = summariseToolInput(toolName, input);
    const id = randomUUID();
    const request: PermissionRequest = {
      id,
      runId,
      taskId: about.taskId,
      projectId: about.projectId,
      subject: about.subject,
      toolName,
      summary,
      detail: JSON.stringify(input, null, 2),
      createdAt: nowIso(),
    };
    return new Promise<PermissionDecision>((resolve) => {
      const row = this.deps.notifier.notify({
        kind: "permission.request",
        ...(about.projectId ? { projectId: about.projectId } : {}),
        title: `${about.subject} wants to run: ${summary}`,
        body: request.detail,
        link: { view: "inbox" },
      });
      this.pending.set(id, { request, notificationId: row.id, input, resolve });
      this.deps.onWaiting?.(runId, true);
      this.deps.bus.emit("permission.changed", { id, pending: true }, about.projectId ?? undefined);
      signal?.addEventListener("abort", () => this.finish(id, deny("The run stopped asking.")));
    });
  }

  list(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  /** The owner's answer. Throws when nobody is waiting for it any more. */
  answer(id: string, allow: boolean, reason?: string): void {
    const pending = this.pending.get(id);
    if (!pending) throw new Error("That request is no longer waiting");
    const message = reason?.trim()
      ? `The owner declined: ${reason.trim()}`
      : "The owner declined this request.";
    this.finish(id, allow ? { behavior: "allow", updatedInput: pending.input } : deny(message));
  }

  /** A run ended or was cancelled: its open questions are denied and dropped. */
  cancelRun(runId: string): void {
    for (const [id, p] of this.pending) {
      if (p.request.runId === runId) this.finish(id, deny("The run ended."));
    }
  }

  private finish(id: string, decision: PermissionDecision): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.deps.notifier.markRead([pending.notificationId]);
    const stillWaiting = [...this.pending.values()].some(
      (p) => p.request.runId === pending.request.runId,
    );
    if (!stillWaiting) this.deps.onWaiting?.(pending.request.runId, false);
    this.deps.bus.emit(
      "permission.changed",
      { id, pending: false },
      pending.request.projectId ?? undefined,
    );
    pending.resolve(decision);
  }
}

const deny = (message: string): PermissionDecision => ({ behavior: "deny", message });
