import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Inventory } from "../../../shared/models";
import type { Role } from "../../../shared/types";
import { OFFICE_TOOL_GUIDANCE } from "../../../shared/office-tools";
import { PERMISSION_TOOL_TIMEOUT_MS } from "../runs/mcp-config";
import { resolveCommand, resolveTool, spawnStream } from "../../core/exec";
import { codexConfigPath, dataDir } from "../../core/paths";
import { writeTextFile } from "../../core/settings";
import { detectCodex } from "../setup/detect";
import { codexInventory } from "../setup/inventory";
import { parseCodexLine, startAgentRun } from "./stream";
import type {
  AgentRun,
  ChatCommandOptions,
  CommandSpec,
  Detection,
  Provider,
  RunOptions,
  TerminalOpener,
} from "./types";

export interface CodexProviderConfig {
  id?: string;
  bin?: string;
  openTerminal?: () => TerminalOpener | null;
}

const typedModelsPath = (): string => join(dataDir(), "codex-models.json");

function configuredModel(): string | undefined {
  try {
    const config = parseToml(readFileSync(codexConfigPath(), "utf8")) as { model?: unknown };
    return typeof config.model === "string" ? config.model : undefined;
  } catch {
    return undefined;
  }
}

function typedModels(): string[] {
  try {
    const typed = JSON.parse(readFileSync(typedModelsPath(), "utf8")) as unknown;
    return Array.isArray(typed) ? typed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

/** The `model` in config.toml first, then every model the owner typed before. */
export function knownCodexModels(): string[] {
  const first = configuredModel();
  return [...(first ? [first] : []), ...typedModels().filter((m) => m !== first)];
}

/** Remembers a model the owner typed, since Codex has no command that lists models. */
export function rememberCodexModel(model: string): void {
  const clean = model.trim();
  if (!clean || knownCodexModels().includes(clean)) return;
  writeTextFile(
    typedModelsPath(),
    `${JSON.stringify([...typedModels(), clean], null, 2)}
`,
  );
}

/**
 * The `-c model_reasoning_effort` value for a role's effort. Codex has no "max"; its highest is "xhigh".
 * (Checked with `codex --version` 0.117.0: the key exists in the binary and `-c` takes any config key.)
 */
export const codexEffort = (effort: NonNullable<Role["effort"]>): string =>
  effort === "max" ? "xhigh" : effort;

function officeMcpFlags(o: RunOptions): string[] {
  const server = o.officeMcp;
  if (!server) return [];
  const env = Object.entries(server.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ");
  return [
    "-c", `mcp_servers.office.command=${JSON.stringify(server.command)}`,
    "-c", `mcp_servers.office.args=${JSON.stringify(server.args)}`,
    "-c", `mcp_servers.office.env={ ${env} }`,
    "-c", "mcp_servers.office.enabled=true",
    "-c", 'mcp_servers.office.default_tools_approval_mode="approve"',
    "-c", `mcp_servers.office.tool_timeout_sec=${PERMISSION_TOOL_TIMEOUT_MS / 1000}`,
  ];
}

function scopedPermissions(o: RunOptions, sandbox: Role["codexSandbox"]): string[] {
  if (!o.brain || !sandbox || sandbox === "danger-full-access") return [];
  const { root, writable, readOnly, private: hidden } = o.brain;
  const writableNotes = sandbox === "workspace-write";
  const filesystem = new Map([
    ...(o.brain.restrictedRead ? [[":root", "deny"], [":minimal", "read"], [o.cwd, "read"]] : []),
    [root, "read"],
    ...readOnly.map((dir) => [dir, "read"]),
    ...writable.map((dir) => [dir, writableNotes ? "write" : "read"]),
    ...hidden.map((dir) => [dir, "deny"]),
  ] as [string, string][]);
  return [
    "-c", 'default_permissions="office-brain"',
    "-c", `permissions.office-brain.extends="${writableNotes ? ":workspace" : ":read-only"}"`,
    "-c", `permissions.office-brain.filesystem={ ${[...filesystem].map(([dir, mode]) => `${JSON.stringify(dir)} = ${JSON.stringify(mode)}`).join(", ")} }`,
  ];
}

/**
 * The arguments of `codex exec`. A role with a writable job gets the workspace-write sandbox, because
 * `exec` runs read-only otherwise; Codex has no system-prompt flag, so the role's instructions go
 * in front of the prompt.
 */
export function codexHeadlessArgs(
  o: RunOptions & { prompt: string; resumeId?: string },
  resultFile: string,
): string[] {
  const flags = ["--json"];
  if (o.role?.model) flags.push("-m", o.role.model);
  if (o.role?.effort) flags.push("-c", `model_reasoning_effort="${codexEffort(o.role.effort)}"`);
  const sandbox = o.permission?.kind === "readonly" || o.role?.autonomy === "ask-first"
    ? "read-only"
    : o.role
    ? (o.role.codexSandbox ?? (o.role.readOnly ? "read-only" : "workspace-write"))
    : null;
  const scope = scopedPermissions(o, sandbox ?? undefined);
  if (o.resumeId) {
    // `codex exec resume` takes neither -C nor -s (checked with --help); the process already runs in cwd.
    if (sandbox && !scope.length) flags.push("-c", `sandbox_mode="${sandbox}"`);
  } else {
    flags.push("-C", o.cwd);
    if (sandbox && !scope.length) flags.push("-s", sandbox);
  }
  flags.push(...scope);
  flags.push(...officeMcpFlags(o));
  if (o.tools !== undefined) {
    flags.push("-c", "features.apps=false", "-c", "features.plugins=false");
    if (!o.tools) flags.push("-c", "features.shell_tool=false");
  }
  flags.push("--skip-git-repo-check", "-o", resultFile);
  const instructions = [o.role?.instructions.trim(), o.brain?.instructions, o.officeMcp && OFFICE_TOOL_GUIDANCE].filter(Boolean).join("\n\n");
  const prompt = instructions ? `${instructions}\n\n${o.prompt}` : o.prompt;
  const exec = o.role?.autonomy || o.permission?.kind === "readonly" ? ["-a", "never", "exec"] : ["exec"];
  return o.resumeId ? [...exec, "resume", ...flags, o.resumeId, prompt] : [...exec, ...flags, prompt];
}

/** Codex through its official CLI (plan 7.3). */
export class CodexProvider implements Provider {
  readonly id: string;
  readonly label = "Codex";
  readonly canResumeHeadless = false;
  private readonly bin: string;
  private readonly openTerminal: () => TerminalOpener | null;

  constructor(config: CodexProviderConfig = {}) {
    this.id = config.id ?? "codex";
    this.bin = config.bin ?? "codex";
    this.openTerminal = config.openTerminal ?? (() => null);
  }

  private command(args: string[], env?: Record<string, string>): CommandSpec {
    const resolved = resolveCommand(resolveTool(this.bin) ?? this.bin, args);
    return { cmd: resolved.file, args: resolved.args, ...(env ? { env } : {}) };
  }

  async detect(): Promise<Detection> {
    const status = await detectCodex(this.bin);
    return {
      installed: status.installed,
      loggedIn: status.loggedIn === true,
      ...(status.version ? { version: status.version } : {}),
      ...(status.problem ? { problem: status.problem } : {}),
    };
  }

  loginCommand(): CommandSpec {
    return this.command(["login"]);
  }

  async login(): Promise<void> {
    const open = this.openTerminal();
    if (!open) throw new Error("No terminal is available to run the login");
    open(this.loginCommand(), "Codex login");
  }

  async models(): Promise<string[]> {
    return knownCodexModels();
  }

  private interactiveArgs(o: RunOptions): string[] {
    const args: string[] = [];
    if (o.role?.model) args.push("-m", o.role.model);
    if (o.role?.effort) args.push("-c", `model_reasoning_effort="${codexEffort(o.role.effort)}"`);
    const sandbox = o.role?.autonomy === "ask-first" ? "read-only" : o.role?.codexSandbox;
    const scope = scopedPermissions(o, sandbox);
    if (scope.length) args.push(...scope);
    else if (sandbox) args.push("-s", sandbox);
    if (o.role?.autonomy) args.push("-a", {
      "ask-first": "on-request",
      "act-on-risk": "on-request",
      "full-auto": "never",
    }[o.role.autonomy]);
    for (const dir of o.addDirs ?? []) args.push("--add-dir", dir);
    args.push(...officeMcpFlags(o));
    const instructions = [o.role?.instructions, o.brain?.instructions, o.officeMcp && OFFICE_TOOL_GUIDANCE].filter(Boolean).join("\n\n");
    if (instructions) args.push("-c", `developer_instructions=${JSON.stringify(instructions)}`);
    args.push("-C", o.cwd);
    return args;
  }

  interactiveCommand(o: RunOptions): CommandSpec {
    return this.command(this.interactiveArgs(o), o.env);
  }

  headless(o: RunOptions & { prompt: string; resumeId?: string }): AgentRun {
    const runDir = o.runDir ?? mkdtempSync(join(tmpdir(), "office-codex-"));
    mkdirSync(runDir, { recursive: true });
    const resultFile = join(runDir, "result.md");
    const spec = this.command(codexHeadlessArgs(o, resultFile), o.env);
    const stream = spawnStream(spec.cmd, spec.args, {
      cwd: o.cwd,
      ...(spec.env ? { env: spec.env } : {}),
    });
    return startAgentRun(stream, parseCodexLine, () =>
      existsSync(resultFile) ? readFileSync(resultFile, "utf8").trim() : null,
    );
  }

  readonly chatKind = "codex" as const;

  /** One `codex exec` per turn: the first starts the thread, later ones resume it (plan 7.3). */
  chatCommand(o: ChatCommandOptions): CommandSpec {
    const role = o.role ?? {
      provider: this.id,
      instructions: "",
      readOnly: false,
      allowedCommands: [],
    };
    const args = codexHeadlessArgs(
      {
        cwd: o.cwd,
        officeSessionId: o.officeSessionId,
        prompt: o.message ?? "",
        permission: o.permission,
        ...(o.brain ? { brain: o.brain } : {}),
        ...(o.officeMcp ? { officeMcp: o.officeMcp } : {}),
        role: { ...role, ...(o.model ? { model: o.model } : {}) },
        ...(o.resume && o.threadId ? { resumeId: o.threadId } : {}),
      },
      join(o.runDir, "turn-result.md"),
    );
    if (o.restricted || o.permission.kind === "readonly") {
      args.unshift("-c", "features.apps=false", "-c", "features.plugins=false");
    }
    return this.command(args);
  }

  resumeCommand(providerSessionId: string, o: RunOptions): CommandSpec {
    // Without a thread id yet, continue the most recent session of this folder.
    return this.command(
      [...this.interactiveArgs(o), "resume", ...(providerSessionId ? [providerSessionId] : ["--last"])],
      o.env,
    );
  }

  async inventory(): Promise<Inventory> {
    return codexInventory();
  }
}
