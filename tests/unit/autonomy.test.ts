import { describe, expect, it } from "vitest";
import { applyAutonomy, effectiveAutonomy, type AutonomyLevel } from "../../src/shared/autonomy";
import { ClaudeCodeProvider, PERMISSION_TOOL } from "../../src/main/modules/providers/claude-code";
import { CodexProvider, codexHeadlessArgs } from "../../src/main/modules/providers/codex";
import type { RunPermission } from "../../src/main/modules/providers/types";
import type { Role } from "../../src/shared/types";

const base: Role = { provider: "fake", instructions: "", readOnly: false, allowedCommands: [] };
const run = { cwd: "C:/fixture", officeSessionId: "fixture" };
const claude = new ClaudeCodeProvider({ bin: "office-fixture-claude" });
const codex = new CodexProvider({ bin: "office-fixture-codex" });
const flag = (args: string[], key: string) => args[args.indexOf(key) + 1];

describe("autonomy", () => {
  it.each([
    ["ask-first", "manual", "read-only", "on-request"],
    ["act-on-risk", "acceptEdits", "workspace-write", "on-request"],
    ["full-auto", "bypassPermissions", "danger-full-access", "never"],
  ] as const)("uses the selected mode when starting and resuming %s", (level, mode, sandbox, approval) => {
    const options = { ...run, role: applyAutonomy(base, level) };
    for (const { args } of [claude.interactiveCommand(options), claude.resumeCommand("one", options)]) {
      expect(flag(args, "--permission-mode")).toBe(mode);
    }
    for (const { args } of [codex.interactiveCommand(options), codex.resumeCommand("one", options)]) {
      expect(flag(args, "-s")).toBe(sandbox);
      expect(flag(args, "-a")).toBe(approval);
    }
  });

  it("allows named checks and keeps other Claude commands on the approval path", () => {
    const args = claudeChat("act-on-risk", { kind: "ask", mcpConfig: "C:/fixture/mcp.json" });
    expect(args).toContain("Bash(npm run lint)");
    expect(args).not.toContain("Bash(npm run:*)");
    expect(args).not.toContain("Bash(git push)");
    expect(flag(args, "--permission-prompts")).toBe("host");
    expect(flag(args, "--permission-prompt-tool")).toBe(PERMISSION_TOOL);
  });

  it("requires a confirmation and does not connect the approval bridge in full auto", () => {
    expect(effectiveAutonomy("full-auto", false)).toBe("act-on-risk");
    expect(effectiveAutonomy("full-auto", true)).toBe("full-auto");
    const args = claudeChat("full-auto", { kind: "full" });
    expect(flag(args, "--permission-mode")).toBe("bypassPermissions");
    expect(args).not.toContain("--mcp-config");
  });

  it("keeps noninteractive Codex Ask first read-only and Act inside the workspace", () => {
    const cmd = (level: AutonomyLevel) =>
      codexHeadlessArgs({ ...run, role: applyAutonomy(base, level), prompt: "fixture" }, "result.md");
    expect(flag(cmd("ask-first"), "-s")).toBe("read-only");
    expect(flag(cmd("act-on-risk"), "-s")).toBe("workspace-write");
    expect(flag(cmd("full-auto"), "-a")).toBe("never");
  });
});

function claudeChat(level: AutonomyLevel, permission: RunPermission): string[] {
  return claude.chatCommand({
    ...run,
    role: applyAutonomy(base, level),
    permission,
    resume: false,
    runDir: run.cwd,
  }).args;
}
