import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "../../src/main/core/workspace";
import { ClaudeCodeProvider, permissionFlags } from "../../src/main/modules/providers/claude-code";
import { codexHeadlessArgs } from "../../src/main/modules/providers/codex";
import type { RunOptions } from "../../src/main/modules/providers/types";
import { WorkspaceEditor } from "../../src/main/modules/tasks/editor";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import {
  BUILT_IN_PROFILES,
  CLAUDE_MODES,
  claudeModeFlags,
  codexSandboxArgs,
  effectiveClaudeMode,
  effectiveSandbox,
  migrateLegacyRoles,
  profileProblems,
  resolveRole,
  resolveWorkspace,
} from "../../src/shared/permissions";
import type { PermissionProfile, Role } from "../../src/shared/types";
import { makeWorld } from "../fixtures/vault/make";

const role = (over: Partial<Role>): Role => ({
  provider: "claude-code",
  instructions: "",
  readOnly: false,
  allowedCommands: [],
  ...over,
});

const claudeArgs = (r: Role, kind: "allowlist" | "readonly" | "ask" = "allowlist"): string[] => {
  const o: RunOptions = {
    cwd: "C:/work",
    officeSessionId: "s1",
    role: r,
    permission: { kind },
  };
  const spec = new ClaudeCodeProvider({ bin: "claude" }).interactiveCommand(o);
  return [...spec.args, ...permissionFlags(o)];
};

describe("a permission profile maps to the exact flags of each provider", () => {
  it("Read only: plan mode, read tools only for Claude, and a read-only sandbox for Codex", () => {
    const r = resolveRole(role({ permissionProfile: "read-only" }), {});
    expect(r).toMatchObject({ readOnly: true, permissionMode: "plan", codexSandbox: "read-only" });
    expect(claudeModeFlags(BUILT_IN_PROFILES["read-only"] as PermissionProfile)).toEqual([
      "--permission-mode",
      "plan",
    ]);
    expect(
      permissionFlags({
        cwd: "x",
        officeSessionId: "s",
        role: r,
        permission: { kind: "readonly" },
      }),
    ).toEqual(["--allowedTools", "Read", "Grep", "Glob", "--permission-prompts", "none"]);
    expect(codexSandboxArgs(BUILT_IN_PROFILES["read-only"] as PermissionProfile)).toEqual([
      "-s",
      "read-only",
    ]);
  });

  it("Ask first: passes --permission-mode manual itself, the project folder for Codex", () => {
    const p = BUILT_IN_PROFILES["ask-first"] as PermissionProfile;
    expect(claudeModeFlags(p)).toEqual(["--permission-mode", "manual"]);
    expect(codexSandboxArgs(p)).toEqual(["-s", "workspace-write"]);
    expect(claudeArgs(resolveRole(role({ permissionProfile: "ask-first" }), {}))).toEqual([
      "--session-id",
      "s1",
      "--permission-mode",
      "manual",
      "--permission-prompts",
      "none",
    ]);
  });

  it('Allowed commands only: dontAsk, and a first-version Ask first ("default") is read as manual', () => {
    const only: PermissionProfile = {
      name: "Strict",
      description: "",
      claudeMode: "dontAsk",
      codexSandbox: "workspace-write",
      allowedCommands: ["Bash(npm test:*)"],
      deniedCommands: [],
    };
    expect(claudeModeFlags(only)).toEqual(["--permission-mode", "dontAsk"]);
    expect(claudeModeFlags({ ...only, claudeMode: "default" })).toEqual([
      "--permission-mode",
      "manual",
    ]);
    expect(CLAUDE_MODES.map((m) => m.id)).toEqual([
      "manual",
      "acceptEdits",
      "plan",
      "auto",
      "dontAsk",
      "bypassPermissions",
    ]);
  });

  it("Plan only: plan mode and a read-only sandbox", () => {
    const p = BUILT_IN_PROFILES["plan-only"] as PermissionProfile;
    expect(claudeModeFlags(p)).toEqual(["--permission-mode", "plan"]);
    expect(codexSandboxArgs(p)).toEqual(["-s", "read-only"]);
  });

  it("Builder: accept edits, the builder commands, and the project folder for Codex", () => {
    const r = resolveRole(role({ permissionProfile: "builder" }), {});
    expect(claudeArgs(r)).toEqual([
      "--session-id",
      "s1",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(npm run:*)",
      "Bash(npm test:*)",
      "--permission-prompts",
      "none",
    ]);
    const codex = codexHeadlessArgs(
      { cwd: "C:/work", officeSessionId: "s", role: r, prompt: "go" },
      "out.md",
    );
    expect(codex).toContain("-s");
    expect(codex[codex.indexOf("-s") + 1]).toBe("workspace-write");
  });

  it("Reviewer: asks first, reads and runs the tests and lint, and cannot edit", () => {
    const r = resolveRole(role({ permissionProfile: "reviewer" }), {});
    expect(r.readOnly).toBe(true);
    const args = claudeArgs(r);
    expect(args.slice(2, 4)).toEqual(["--permission-mode", "manual"]);
    expect(args).toContain("Bash(npm run lint:*)");
    expect(args).toContain("Bash(npm test:*)");
    expect(args.some((a) => /Edit|Write/.test(a))).toBe(false);
    const codex = codexHeadlessArgs(
      { cwd: "C:/work", officeSessionId: "s", role: r, prompt: "go" },
      "out.md",
    );
    expect(codex[codex.indexOf("-s") + 1]).toBe("read-only");
  });

  it("a custom profile's denied commands become --disallowedTools, one argument each", () => {
    const custom: Record<string, PermissionProfile> = {
      careful: {
        name: "Careful",
        description: "",
        claudeMode: "acceptEdits",
        codexSandbox: "workspace-write",
        allowedCommands: ["Bash(git status:*)"],
        deniedCommands: ["Bash(rm:*)", "Bash(git push:*)"],
      },
    };
    const r = resolveRole(role({ permissionProfile: "careful" }), custom);
    expect(
      permissionFlags({
        cwd: "x",
        officeSessionId: "s",
        role: r,
        permission: { kind: "allowlist" },
      }),
    ).toEqual([
      "--allowedTools",
      "Bash(git status:*)",
      "--disallowedTools",
      "Bash(rm:*)",
      "Bash(git push:*)",
      "--permission-prompts",
      "none",
    ]);
  });
});

describe("Bypass permissions and Full access only after the confirmation", () => {
  const unsafe = (confirmed: boolean): PermissionProfile => ({
    name: "Wide open",
    description: "",
    claudeMode: "bypassPermissions",
    codexSandbox: "danger-full-access",
    allowedCommands: [],
    deniedCommands: [],
    ...(confirmed ? { confirmedUnsafe: true } : {}),
  });

  it("is never what a profile runs with until it is confirmed on the profile", () => {
    expect(effectiveClaudeMode(unsafe(false))).toBe("acceptEdits");
    expect(effectiveSandbox(unsafe(false))).toBe("workspace-write");
    expect(claudeModeFlags(unsafe(false))).toEqual(["--permission-mode", "acceptEdits"]);
    expect(codexSandboxArgs(unsafe(false))).toEqual(["-s", "workspace-write"]);
    expect(claudeModeFlags(unsafe(true))).toEqual(["--permission-mode", "bypassPermissions"]);
    expect(codexSandboxArgs(unsafe(true))).toEqual(["-s", "danger-full-access"]);
  });

  it("cannot be saved without the confirmation, and says why", () => {
    expect(profileProblems(unsafe(false)).join(" ")).toMatch(
      /Bypass permissions needs the confirmation/,
    );
    expect(profileProblems(unsafe(true))).toEqual([]);
  });

  it("is never a built-in default, and is the only unsafe choice in each list", () => {
    for (const p of Object.values(BUILT_IN_PROFILES)) {
      expect(p.claudeMode).not.toBe("bypassPermissions");
      expect(p.codexSandbox).not.toBe("danger-full-access");
    }
    expect(CLAUDE_MODES.filter((m) => m.unsafe).map((m) => m.id)).toEqual(["bypassPermissions"]);
  });
});

describe("the migration of roles written with the old fields", () => {
  const OLD: Record<string, Role> = {
    planner: role({ permissionMode: "plan", instructions: "Plan." }),
    builder: role({
      permissionMode: "acceptEdits",
      allowedCommands: ["Bash(git status:*)", "Bash(npm test:*)"],
    }),
    reviewer: role({ provider: "codex", readOnly: true }),
    researcher: role({ readOnly: true, model: "sonnet" }),
    plain: role({}),
  };

  it("keeps what each old role did: the same flags before and after", () => {
    const { roles, profiles } = migrateLegacyRoles(OLD, {});
    for (const [id, old] of Object.entries(OLD)) {
      // Before, an old role with no mode asked first by leaving the flag out; now the flag is always passed.
      const before = { ...old, permissionMode: old.permissionMode ?? "manual" };
      const after = resolveRole(roles[id] as Role, profiles);
      expect(claudeArgs(after, "allowlist"), id).toEqual(claudeArgs(before, "allowlist"));
      expect(claudeArgs(after, "readonly"), id).toEqual(claudeArgs(before, "readonly"));
      const run = { cwd: "C:/work", officeSessionId: "s", prompt: "go" };
      expect(codexHeadlessArgs({ ...run, role: after }, "out.md"), id).toEqual(
        codexHeadlessArgs({ ...run, role: before }, "out.md"),
      );
    }
  });

  it("uses a built-in profile where the old settings equal it, and makes one only where they differ", () => {
    const { roles, profiles, matched, kept, migrated } = migrateLegacyRoles(OLD, {});
    expect(migrated).toHaveLength(5);
    expect(matched).toEqual(["plain"]);
    expect(roles["plain"]?.permissionProfile).toBe("ask-first");
    expect(kept).toEqual(["planner", "builder", "reviewer", "researcher"]);
    expect(Object.keys(profiles).sort()).toEqual([
      "builder-role",
      "planner",
      "researcher",
      "reviewer-role",
    ]);
    expect(roles["builder"]?.permissionProfile).toBe("builder-role");
  });

  it("names a kept profile in sentence case and describes it with a real sentence", () => {
    const { profiles } = migrateLegacyRoles(OLD, {});
    expect(profiles["planner"]?.name).toBe("Planner's settings");
    expect(profiles["builder-role"]?.name).toBe("Builder's settings");
    for (const p of Object.values(profiles)) {
      expect(p.description).toMatch(/^Claude Code: .+. Codex: .+./);
      expect(p.description).not.toMatch(/\b(old|legacy|migrat\w*)\b/i);
    }
    expect(profiles["builder-role"]?.description).toContain(
      "It may run 2 commands without asking.",
    );
  });

  it("migrates once: roles that name a profile are left alone", () => {
    const { profiles } = migrateLegacyRoles(OLD, {});
    const again = migrateLegacyRoles(
      Object.fromEntries(
        Object.entries(OLD).map(([id]) => [id, { ...OLD[id], permissionProfile: id } as Role]),
      ),
      profiles,
    );
    expect(again.migrated).toEqual([]);
  });

  it("resolves a whole workspace, and loads it from the file the editor writes", async () => {
    const world = makeWorld();
    const store = new WorkspaceStore();
    await store.open(world.hub, world.workspaceConfigPath);
    const loaded = store.state.workspace;
    expect(loaded?.roles["builder"]?.permissionProfile).toBe("builder-role");
    expect(loaded?.roles["builder"]?.allowedCommands).toContain("Bash(git status:*)");
    expect(resolveWorkspace(loaded as never).roles["builder"]).toEqual(loaded?.roles["builder"]);

    const writer = new VaultWriter({ hubRoot: () => world.hub, onWarning: () => undefined });
    const editor = new WorkspaceEditor({
      writer,
      workspaceFile: () => store.filePath,
      reload: () => void store.reload(),
      adopt: (w) => store.adopt(w),
    });
    // Any edit writes the migration to the file; an edit of a profile does too.
    await editor.saveProfile("strict", {
      name: "Strict",
      description: "Reads and runs the tests.",
      claudeMode: "default",
      codexSandbox: "read-only",
      allowedCommands: ["Bash(npm test:*)"],
      deniedCommands: [],
    });
    const file = JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
    expect(file.roles.builder.permissionProfile).toBe("builder-role");
    expect(file.roles.builder.allowedCommands).toBeUndefined();
    expect(file.permissionProfiles.strict.codexSandbox).toBe("read-only");
    expect(file.permissionProfiles["builder-role"].allowedCommands).toContain("Bash(git status:*)");

    // Bypass cannot be saved without the confirmation; a built-in profile cannot be changed.
    await expect(
      editor.saveProfile("wide", {
        name: "Wide",
        description: "",
        claudeMode: "bypassPermissions",
        codexSandbox: "workspace-write",
        allowedCommands: [],
        deniedCommands: [],
      }),
    ).rejects.toThrow(/needs the confirmation/);
    await expect(
      editor.saveProfile("builder", { ...(BUILT_IN_PROFILES["builder"] as PermissionProfile) }),
    ).rejects.toThrow(/duplicate it/);
    // A profile that a role uses cannot be removed.
    await editor.saveRole("tester", {
      provider: "claude-code",
      instructions: "",
      permissionProfile: "strict",
    });
    await expect(editor.removeProfile("strict")).rejects.toThrow(/used by the role "tester"/);
    await store.close();
  });
});
