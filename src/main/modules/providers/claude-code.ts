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
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

/**
 * `--allowedTools` with one argument per rule, as the CLI documents it. A rule such as "Bash(git status:*)"
 * has a space inside its parentheses, so rules are never joined into one string. The option is variadic, so
 * whatever follows it in the argument list must be another `--` flag.
 */
const allowedTools = (rules: string[]): string[] =>
  rules.length > 0 ? ["--allowedTools", ...rules] : [];
/** The name Claude Code gives Office's permission tool: mcp__<server>__<tool>. */
export const PERMISSION_TOOL = "mcp__office__office_permission";

/**
 * The flags that say who answers permission requests in a headless run. Every run sets
 * `--permission-prompts` explicitly, so the default of the installed Claude Code never decides.
 */
export function permissionFlags(o: RunOptions): string[] {
  const allowed = o.role?.allowedCommands ?? [];
  const kind = o.permission?.kind;
  if (kind === "readonly")
    return [...allowedTools(READ_ONLY_TOOLS), "--permission-prompts", "none"];
  if (kind === "allowlist") return [...allowedTools(allowed), "--permission-prompts", "none"];
  if (kind === "ask") {
    return [
      ...allowedTools(allowed),
      ...(o.permission?.mcpConfig ? ["--mcp-config", o.permission.mcpConfig] : []),
      "--permission-prompts",
      "host",
      "--permission-prompt-tool",
      PERMISSION_TOOL,
    ];
  }
  // No kind given: the older behaviour, read-only roles get read tools.
  return o.role?.readOnly ? allowedTools(READ_ONLY_TOOLS) : [];
}

/** The arguments of `claude -p` for one headless run. */
export function claudeHeadlessArgs(
  o: RunOptions & { prompt: string; resumeId?: string },
  roleFlags: string[],
): string[] {
  const args = ["-p", o.prompt, "--output-format", "stream-json", "--verbose", ...roleFlags];
  if (o.resumeId) args.push("--resume", o.resumeId);
  args.push(...permissionFlags(o));
  return args;
}

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
    const args = claudeHeadlessArgs(o, this.roleFlags(o));
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
