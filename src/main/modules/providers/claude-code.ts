import type { Inventory } from "../../../shared/models";
import { resolveCommand, resolveTool, spawnStream } from "../../core/exec";
import { detectClaude } from "../setup/detect";
import { claudeInventory } from "../setup/inventory";
import { parseClaudeLine, startAgentRun } from "./stream";
import type {
  AgentRun,
  ChatCommandOptions,
  CommandSpec,
  Detection,
  Provider,
  RunOptions,
  TerminalOpener,
} from "./types";

/** The only tools a Chat may use: read the brain and the web, nothing that runs or edits. */
export const CHAT_TOOLS = "Read,Grep,Glob,WebSearch,WebFetch";

/**
 * The flags of a Chat: `--tools` limits what exists, `--allowedTools` lets those run without asking, and
 * `--permission-mode dontAsk` (Allowed commands only) refuses anything else without ever asking. The brain is added
 * to read with `--add-dir`.
 */
export function chatToolFlags(addDirs: string[], model?: string): string[] {
  return [
    ...(model ? ["--model", model] : []),
    "--tools",
    CHAT_TOOLS,
    "--allowedTools",
    CHAT_TOOLS,
    "--permission-mode",
    "dontAsk",
    ...addDirs.flatMap((dir) => ["--add-dir", dir]),
  ];
}

export const CLAUDE_MODELS = ["opus", "sonnet", "haiku"];
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

/**
 * `--allowedTools` with one argument per rule, as the CLI documents it. A rule such as "Bash(git status:*)"
 * has a space inside its parentheses, so rules are never joined into one string. The option is variadic, so
 * whatever follows it in the argument list must be another `--` flag.
 */
const allowedTools = (rules: string[]): string[] =>
  rules.length > 0 ? ["--allowedTools", ...rules] : [];
/** `--disallowedTools`, the same way: rules an agent may never use, one argument each. */
const disallowedTools = (rules: string[]): string[] =>
  rules.length > 0 ? ["--disallowedTools", ...rules] : [];
/** The name Claude Code gives Office's permission tool: mcp__<server>__<tool>. */
export const PERMISSION_TOOL = "mcp__office__office_permission";

/**
 * The flags that say who answers permission requests in a headless run. Every run sets
 * `--permission-prompts` explicitly, so the default of the installed Claude Code never decides.
 */
export function permissionFlags(o: RunOptions): string[] {
  const allowed = o.role?.allowedCommands ?? [];
  const denied = disallowedTools(o.role?.deniedCommands ?? []);
  const kind = o.permission?.kind;
  if (kind === "full") return ["--permission-prompts", "none"];
  if (kind === "readonly")
    return [...allowedTools(READ_ONLY_TOOLS), ...denied, "--permission-prompts", "none"];
  if (kind === "allowlist")
    return [...allowedTools(allowed), ...denied, "--permission-prompts", "none"];
  if (kind === "ask") {
    return [
      ...allowedTools(allowed),
      ...denied,
      ...(o.permission?.mcpConfig ? ["--mcp-config", o.permission.mcpConfig] : []),
      "--permission-prompts",
      "host",
      "--permission-prompt-tool",
      PERMISSION_TOOL,
    ];
  }
  // No kind given: the older behaviour, read-only roles get read tools.
  return [...(o.role?.readOnly ? allowedTools(READ_ONLY_TOOLS) : []), ...denied];
}

export function claudePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^([a-z]):/i, (_, drive: string) => `/${drive.toLowerCase()}`);
  return `/${normalized.replace(/([*?[\]])/g, "\\$1")}`;
}

function sessionSettings(o: Pick<RunOptions, "brain" | "role">): string[] {
  const ask = o.role?.autonomy === "ask-first" ? ["Edit", "Write", "NotebookEdit", "Bash", "PowerShell"] : [];
  const denied = o.brain ? [
    ...o.brain.private.map((dir) => `Read(${claudePath(dir)}/**)`),
    ...[...o.brain.readOnly, ...o.brain.private].map((dir) => `Edit(${claudePath(dir)}/**)`),
    ...["_index.md", "brain.repos.json"].map((file) => `Edit(${claudePath(`${o.brain!.root}/${file}`)})`),
  ] : [];
  if (!ask.length && !denied.length) return [];
  const settings = { permissions: { ask, deny: denied } };
  return ["--settings", JSON.stringify(settings)];
}

/** The arguments of `claude -p` for one headless run. */
export function claudeHeadlessArgs(
  o: RunOptions & { prompt: string; resumeId?: string },
  roleFlags: string[],
): string[] {
  const args = [
    "-p",
    o.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    ...roleFlags,
    ...(o.tools === undefined ? [] : ["--tools", o.tools]),
  ];
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
  private roleFlags(o: RunOptions, mode?: string): string[] {
    const role = o.role;
    const flags: string[] = [];
    if (role?.model) flags.push("--model", role.model);
    if (role?.effort) flags.push("--effort", role.effort);
    const chosen = mode ?? role?.permissionMode;
    if (chosen) flags.push("--permission-mode", chosen);
    const instructions = [role?.instructions, o.brain?.instructions].filter(Boolean).join("\n\n");
    if (instructions) flags.push("--append-system-prompt", instructions);
    for (const dir of new Set([...(o.addDirs ?? []), ...(o.brain?.writable ?? [])]))
      flags.push("--add-dir", dir);
    return [...flags, ...sessionSettings(o)];
  }

  private terminalFlags(o: RunOptions): string[] {
    if (!o.role?.autonomy) return this.roleFlags(o);
    return [
      ...this.roleFlags(o),
      ...allowedTools(o.role?.allowedCommands ?? []),
      ...disallowedTools(o.role?.deniedCommands ?? []),
    ];
  }

  /** The Office session id is the Claude session id, so hook events map straight back (plan 7.2). */
  interactiveCommand(o: RunOptions): CommandSpec {
    return this.command(["--session-id", o.officeSessionId, ...this.terminalFlags(o)], o.env);
  }

  headless(o: RunOptions & { prompt: string; resumeId?: string }): AgentRun {
    // A run nobody watches (an automation, a brief) gets the allowed commands only: whatever is not on the list is
    // refused without asking (plan 6.3). A stage that asks the owner, and a read-only run, keep their own mode.
    const args = claudeHeadlessArgs(
      o,
      this.roleFlags(o, o.permission?.kind === "allowlist" || o.tools !== undefined ? "dontAsk" : undefined),
    );
    const spec = this.command(args, o.env);
    const stream = spawnStream(spec.cmd, spec.args, {
      cwd: o.cwd,
      ...(spec.env ? { env: spec.env } : {}),
    });
    return startAgentRun(stream, parseClaudeLine);
  }

  readonly chatKind = "claude" as const;

  /**
   * One long-lived `claude -p` per chat: each message is a JSON line on stdin, the answer streams out as
   * JSON lines with partial messages. `--session-id` makes the Office id the Claude id; `--resume` reopens
   * the conversation after a stop. Approvals use the permission flags of plan 9.5.
   */
  chatCommand(o: ChatCommandOptions): CommandSpec {
    const role = o.role
      ? {
          ...o.role,
          ...(o.model ? { model: o.model } : {}),
          ...(o.permissionMode ? { permissionMode: o.permissionMode } : {}),
        }
      : {
          provider: this.id,
          instructions: "",
          readOnly: false,
          allowedCommands: [],
          ...(o.model ? { model: o.model } : {}),
          // Ask first is passed explicitly, so the owner's own default setting never decides.
          permissionMode: o.permissionMode ?? "manual",
        };
    const runOptions: RunOptions = {
      cwd: o.cwd,
      officeSessionId: o.officeSessionId,
      role,
      permission: o.permission,
      ...(o.addDirs ? { addDirs: o.addDirs } : {}),
      ...(o.brain ? { brain: o.brain } : {}),
    };
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      // An incognito conversation is never saved, so there is nothing to resume.
      o.resume && !o.incognito ? "--resume" : "--session-id",
      o.officeSessionId,
      ...(o.restricted
        ? [...chatToolFlags(o.addDirs ?? [], runOptions.role?.model), ...this.roleFlags({ ...runOptions, role: undefined, addDirs: undefined })]
        : [...this.roleFlags(runOptions), ...permissionFlags(runOptions)]),
      ...(o.incognito ? ["--no-session-persistence"] : []),
    ];
    return this.command(args);
  }

  resumeCommand(providerSessionId: string, o: RunOptions): CommandSpec {
    return this.command(["--resume", providerSessionId, ...this.terminalFlags(o)], o.env);
  }

  inventory(projectPath?: string): Promise<Inventory> {
    return claudeInventory(projectPath, this.bin);
  }
}
