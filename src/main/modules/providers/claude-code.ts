import type { Inventory } from "../../../shared/models";
import { resolveCommand, resolveTool, spawnStream } from "../../core/exec";
import { detectClaude } from "../setup/detect";
import { claudeInventory } from "../setup/inventory";
import { parseClaudeLine, startAgentRun } from "./stream";
import type {
  AgentRun,
  CommandSpec,
  Detection,
  Provider,
  RunOptions,
  TerminalOpener,
} from "./types";

export const CLAUDE_MODELS = ["opus", "sonnet", "haiku"];
const READ_ONLY_TOOLS = "Read Grep Glob";

export interface ClaudeProviderConfig {
  id?: string;
  label?: string;
  /** Name of the executable to look up (the fake provider uses another name). */
  bin?: string;
  openTerminal?: () => TerminalOpener | null;
}

/** Claude Code through its official CLI (plan 7.2). */
export class ClaudeCodeProvider implements Provider {
  readonly id: string;
  readonly label: string;
  readonly canResumeHeadless = true;
  private readonly bin: string;
  private readonly openTerminal: () => TerminalOpener | null;

  constructor(config: ClaudeProviderConfig = {}) {
    this.id = config.id ?? "claude-code";
    this.label = config.label ?? "Claude Code";
    this.bin = config.bin ?? "claude";
    this.openTerminal = config.openTerminal ?? (() => null);
  }

  private command(args: string[], env?: Record<string, string>): CommandSpec {
    const resolved = resolveCommand(resolveTool(this.bin) ?? this.bin, args);
    return { cmd: resolved.file, args: resolved.args, ...(env ? { env } : {}) };
  }

  async detect(): Promise<Detection> {
    const status = await detectClaude(this.bin, this.id);
    return {
      installed: status.installed,
      loggedIn: status.loggedIn === true,
      ...(status.version ? { version: status.version } : {}),
      ...(status.problem ? { problem: status.problem } : {}),
    };
  }

  loginCommand(): CommandSpec {
    return this.command(["auth", "login"]);
  }

  async login(): Promise<void> {
    const open = this.openTerminal();
    if (!open) throw new Error("No terminal is available to run the login");
    open(this.loginCommand(), `${this.label} login`);
  }

  async models(): Promise<string[]> {
    return CLAUDE_MODELS;
  }

  /** Flags that carry a role: model, effort, permission mode and standing instructions. */
  private roleFlags(o: RunOptions): string[] {
    const role = o.role;
    const flags: string[] = [];
    if (role?.model) flags.push("--model", role.model);
    if (role?.effort) flags.push("--effort", role.effort);
    if (role?.permissionMode) flags.push("--permission-mode", role.permissionMode);
    if (role?.instructions) flags.push("--append-system-prompt", role.instructions);
    for (const dir of o.addDirs ?? []) flags.push("--add-dir", dir);
    return flags;
  }

  /** The Office session id is the Claude session id, so hook events map straight back (plan 7.2). */
  interactiveCommand(o: RunOptions): CommandSpec {
    return this.command(["--session-id", o.officeSessionId, ...this.roleFlags(o)], o.env);
  }

  headless(o: RunOptions & { prompt: string; resumeId?: string }): AgentRun {
    const args = [
      "-p",
      o.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      ...this.roleFlags(o),
    ];
    if (o.resumeId) args.push("--resume", o.resumeId);
    if (o.role?.readOnly) args.push("--allowedTools", READ_ONLY_TOOLS);
    const spec = this.command(args, o.env);
    const stream = spawnStream(spec.cmd, spec.args, {
      cwd: o.cwd,
      ...(spec.env ? { env: spec.env } : {}),
    });
    return startAgentRun(stream, parseClaudeLine);
  }

  resumeCommand(providerSessionId: string, o: RunOptions): CommandSpec {
    return this.command(["--resume", providerSessionId], o.env);
  }

  inventory(projectPath?: string): Promise<Inventory> {
    return claudeInventory(projectPath, this.bin);
  }
}
