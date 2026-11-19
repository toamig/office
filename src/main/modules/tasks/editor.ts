import {
  BUILT_IN_PROFILES,
  migrateLegacyRoles,
  profileProblems,
  resolveWorkspace,
  roleForFile,
} from "../../../shared/permissions";
import {
  PermissionProfile as ProfileSchema,
  Pipeline as PipelineSchema,
  Role as RoleSchema,
  Workspace as WorkspaceSchema,
} from "../../../shared/schemas";
import type { z } from "zod";
import type { Automation, PermissionProfile, Role, Workspace } from "../../../shared/types";
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

/** Old roles (a permission mode, read only, allowed commands) become profiles named after the role, in the file. */
function migrateJson(json: Json): void {
  const parsed = WorkspaceSchema.safeParse(json);
  if (!parsed.success) return;
  const { roles, profiles, migrated } = migrateLegacyRoles(
    parsed.data.roles,
    parsed.data.permissionProfiles,
  );
  if (migrated.length === 0) return;
  const out: Json = {};
  for (const [id, role] of Object.entries(roles)) out[id] = roleForFile(role as Role);
  json["roles"] = out;
  json["permissionProfiles"] = profiles;
}

/** A role as the owner writes it: fields with defaults may be left out. */
type RoleInput = z.input<typeof RoleSchema>;

const ID_RE = /^[a-z0-9-]+$/;
const BUILT_IN_IDS = new Set(Object.keys(BUILT_IN_PROFILES));

/** Edits the workspace config through the vault writer: validated, committed and pushed like any note. */
export class WorkspaceEditor {
  constructor(private readonly deps: EditorDeps) {}

  private async edit(message: string, change: (json: Json) => void): Promise<void> {
    await this.deps.writer.edit(this.deps.workspaceFile(), message, (text) => {
      const json = JSON.parse(text) as Json;
      migrateJson(json);
      change(json);
      // A role that was written with the old fields (a permission mode, read only) becomes a profile too.
      migrateJson(json);
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
      this.deps.adopt(resolveWorkspace(checked.data));
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
      // A role with a profile is written without the fields the profile decides; one written with the old fields
      // keeps them here and becomes a profile of its own right after (migrateJson).
      roles[id] = parsed.data.permissionProfile ? roleForFile(parsed.data as Role) : parsed.data;
    });
  }

  /** Adds or replaces a permission profile. Bypass permissions and Full access need the owner's confirmation. */
  async saveProfile(id: string, profile: z.input<typeof ProfileSchema>): Promise<void> {
    if (!ID_RE.test(id))
      throw new IpcFailure("bad-id", "A profile id uses lowercase letters, digits and dashes");
    if (BUILT_IN_IDS.has(id))
      throw new IpcFailure("built-in", "A built-in profile cannot be changed; duplicate it first.");
    const parsed = ProfileSchema.safeParse(profile);
    if (!parsed.success)
      throw new IpcFailure(
        "invalid",
        `That profile is not valid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
      );
    const problems = profileProblems(parsed.data as PermissionProfile);
    if (problems.length > 0)
      throw new IpcFailure("invalid", problems[0] ?? "That profile is not valid");
    await this.edit(`Workspace: update permission profile ${id}`, (json) => {
      const profiles = (json["permissionProfiles"] ??= {}) as Json;
      profiles[id] = parsed.data;
    });
  }

  /** Removes a custom profile, unless a role still uses it. */
  async removeProfile(id: string): Promise<void> {
    await this.edit(`Workspace: remove permission profile ${id}`, (json) => {
      const roles = (json["roles"] ?? {}) as Record<string, { permissionProfile?: string }>;
      for (const [rid, r] of Object.entries(roles))
        if (r.permissionProfile === id)
          throw new IpcFailure("in-use", `The profile "${id}" is used by the role "${rid}"`);
      delete (json["permissionProfiles"] as Json | undefined)?.[id];
    });
  }

  /** Adds or replaces a pipeline: its stages in order, each with a role. */
  async savePipeline(id: string, pipeline: z.input<typeof PipelineSchema>): Promise<void> {
    if (!ID_RE.test(id))
      throw new IpcFailure("bad-id", "A pipeline id uses lowercase letters, digits and dashes");
    const parsed = PipelineSchema.safeParse(pipeline);
    if (!parsed.success)
      throw new IpcFailure(
        "invalid",
        `That pipeline is not valid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
      );
    await this.edit(`Workspace: update pipeline ${id}`, (json) => {
      const roles = (json["roles"] ?? {}) as Json;
      for (const s of parsed.data.stages)
        if (!(s.role in roles))
          throw new IpcFailure(
            "no-role",
            `The stage "${s.id}" uses the role "${s.role}", which does not exist`,
          );
      const ids = parsed.data.stages.map((s) => s.id);
      if (new Set(ids).size !== ids.length)
        throw new IpcFailure("invalid", "Two stages have the same id");
      const pipelines = (json["pipelines"] ??= {}) as Json;
      pipelines[id] = parsed.data;
    });
  }

  /** Removes a pipeline. */
  async removePipeline(id: string): Promise<void> {
    await this.edit(`Workspace: remove pipeline ${id}`, (json) => {
      delete (json["pipelines"] as Json | undefined)?.[id];
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
