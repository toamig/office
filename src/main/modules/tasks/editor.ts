import { Role as RoleSchema, Workspace as WorkspaceSchema } from "../../../shared/schemas";
import type { z } from "zod";
import type { Automation, Workspace } from "../../../shared/types";
import { validCron } from "../../core/scheduler";
import { IpcFailure } from "../../core/ipc";
import type { VaultWriter } from "../vault/writer";

export interface EditorDeps {
  writer: VaultWriter;
  workspaceFile: () => string;
  reload: () => void;
  /** Makes the validated config the in-memory one as soon as it is written. */
  adopt: (workspace: Workspace) => void;
}

type Json = Record<string, unknown>;

/** A role as the owner writes it: fields with defaults may be left out. */
type RoleInput = z.input<typeof RoleSchema>;

const ID_RE = /^[a-z0-9-]+$/;

/** Edits the workspace config through the vault writer: validated, committed and pushed like any note. */
export class WorkspaceEditor {
  constructor(private readonly deps: EditorDeps) {}

  private async edit(message: string, change: (json: Json) => void): Promise<void> {
    await this.deps.writer.edit(this.deps.workspaceFile(), message, (text) => {
      const json = JSON.parse(text) as Json;
      change(json);
      const checked = WorkspaceSchema.safeParse(json);
      if (!checked.success) {
        const issue = checked.error.issues[0];
        throw new IpcFailure(
          "invalid",
          `That change is not valid: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(),
        );
      }
      // The file is written right after this returns, but the commit and push come later; whoever reads
      // the workspace in between (the ntfy channel, for one) must already see the new config.
      this.deps.adopt(checked.data);
      return `${JSON.stringify(json, null, 2)}\n`;
    });
    this.deps.reload();
  }

  /** Adds or replaces a role. The role is checked against the schema before anything is written. */
  async saveRole(id: string, role: RoleInput): Promise<void> {
    if (!ID_RE.test(id))
      throw new IpcFailure("bad-id", "A role id uses lowercase letters, digits and dashes");
    const parsed = RoleSchema.safeParse(role);
    if (!parsed.success) {
      throw new IpcFailure(
        "invalid",
        `That role is not valid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
      );
    }
    await this.edit(`Workspace: update role ${id}`, (json) => {
      const roles = (json["roles"] ??= {}) as Json;
      roles[id] = parsed.data;
    });
  }

  /** Changes which notification kinds are urgent, which projects are muted, and the ntfy topic. */
  async setNotifications(patch: {
    urgent?: string[];
    mutedProjects?: string[];
    ntfyTopicUrl?: string;
  }): Promise<void> {
    await this.edit("Workspace: notification rules", (json) => {
      const n = (json["notifications"] ??= {}) as Json;
      if (patch.urgent) n["urgent"] = patch.urgent;
      if (patch.mutedProjects) n["mutedProjects"] = patch.mutedProjects;
      if (patch.ntfyTopicUrl !== undefined) {
        if (patch.ntfyTopicUrl.trim() === "") delete n["ntfyTopicUrl"];
        else n["ntfyTopicUrl"] = patch.ntfyTopicUrl.trim();
      }
    });
  }

  /** Adds or replaces an automation (a scheduled prompt on a project). */
  async saveAutomation(automation: Automation): Promise<void> {
    if (!ID_RE.test(automation.id))
      throw new IpcFailure("bad-id", "An automation id uses lowercase letters, digits and dashes");
    if (!validCron(automation.cron))
      throw new IpcFailure("bad-cron", `"${automation.cron}" is not a valid cron expression`);
    await this.edit(`Workspace: automation ${automation.id}`, (json) => {
      const list = ((json["automations"] ??= []) as Array<{ id?: string }>).filter(
        (a) => a.id !== automation.id,
      );
      list.push(automation as unknown as { id?: string });
      json["automations"] = list;
    });
  }

  async removeAutomation(id: string): Promise<void> {
    await this.edit(`Workspace: remove automation ${id}`, (json) => {
      json["automations"] = ((json["automations"] ?? []) as Array<{ id?: string }>).filter(
        (a) => a.id !== id,
      );
    });
  }

  /** Removes a role, unless a pipeline stage or a project override still uses it. */
  async removeRole(id: string): Promise<void> {
    await this.edit(`Workspace: remove role ${id}`, (json) => {
      const pipelines = (json["pipelines"] ?? {}) as Record<
        string,
        { stages?: Array<{ role?: string }> }
      >;
      for (const [pid, p] of Object.entries(pipelines)) {
        if ((p.stages ?? []).some((s) => s.role === id)) {
          throw new IpcFailure("in-use", `The role "${id}" is used by the "${pid}" pipeline`);
        }
      }
      const projects = (json["projects"] ?? []) as Array<{
        name?: string;
        roles?: Record<string, string>;
      }>;
      for (const p of projects) {
        if (Object.entries(p.roles ?? {}).some(([k, v]) => k === id || v === id)) {
          throw new IpcFailure(
            "in-use",
            `The role "${id}" is used by a project override (${p.name ?? "a project"})`,
          );
        }
      }
      delete (json["roles"] as Json)[id];
    });
  }

  /** Pins, unpins, groups, ungroups, archives or restores a project in the workspace config. */
  async updateProject(
    projectId: string,
    patch: { pinned?: boolean; group?: string | null; archived?: boolean },
  ): Promise<void> {
    await this.edit(`Workspace: update project ${projectId}`, (json) => {
      const projects = (json["projects"] ?? []) as Array<Record<string, unknown>>;
      const project = projects.find((p) => p["id"] === projectId);
      if (!project) throw new IpcFailure("not-found", `No project with id ${projectId}`);
      if (patch.pinned !== undefined) project["pinned"] = patch.pinned;
      if (patch.archived !== undefined) project["archived"] = patch.archived;
      if (patch.group !== undefined) {
        const group = patch.group === null ? "" : patch.group.trim();
        if (group === "") delete project["group"];
        else project["group"] = group;
      }
    });
  }

  /** Sets (or clears, with null) a project's override: when it asks for `role`, it gets `target` instead. */
  async setOverride(projectId: string, role: string, target: string | null): Promise<void> {
    await this.edit(`Workspace: ${projectId} role override`, (json) => {
      const roles = (json["roles"] ?? {}) as Json;
      if (target !== null && !(target in roles))
        throw new IpcFailure("no-role", `There is no role called "${target}"`);
      const projects = (json["projects"] ?? []) as Array<Record<string, unknown>>;
      const project = projects.find((p) => p["id"] === projectId);
      if (!project) throw new IpcFailure("not-found", `No project with id ${projectId}`);
      const overrides = { ...((project["roles"] as Record<string, string> | undefined) ?? {}) };
      if (target === null) delete overrides[role];
      else overrides[role] = target;
      if (Object.keys(overrides).length === 0) delete project["roles"];
      else project["roles"] = overrides;
    });
  }
}
