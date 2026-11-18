import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Inventory } from "../../../shared/models";
import { resolveCommand, resolveTool, spawnStream } from "../../core/exec";
import { codexConfigPath, dataDir } from "../../core/paths";
import { writeTextFile } from "../../core/settings";
import { detectCodex } from "../setup/detect";
import { codexInventory } from "../setup/inventory";
import { parseCodexLine, startAgentRun } from "./stream";
import type {
  AgentRun,
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

/** Codex through its official CLI (plan 7.3). */
export class CodexProvider implements Provider {
  readonly id: string;
  readonly label = "Codex";
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

  interactiveCommand(o: RunOptions): CommandSpec {
    const args: string[] = [];
    if (o.role?.model) args.push("-m", o.role.model);
    args.push("-C", o.cwd);
    return this.command(args, o.env);
  }

  headless(o: RunOptions & { prompt: string; resumeId?: string }): AgentRun {
    const runDir = o.runDir ?? mkdtempSync(join(tmpdir(), "office-codex-"));
    mkdirSync(runDir, { recursive: true });
    const resultFile = join(runDir, "result.md");
    const flags = ["--json"];
    if (o.role?.model) flags.push("-m", o.role.model);
    flags.push("-C", o.cwd);
    if (o.role?.readOnly) flags.push("-s", "read-only");
    flags.push("--skip-git-repo-check", "-o", resultFile);
    const args = o.resumeId
      ? ["exec", "resume", ...flags, o.resumeId, o.prompt]
      : ["exec", ...flags, o.prompt];
    const spec = this.command(args, o.env);
    const stream = spawnStream(spec.cmd, spec.args, {
      cwd: o.cwd,
      ...(spec.env ? { env: spec.env } : {}),
    });
    return startAgentRun(stream, parseCodexLine, () =>
      existsSync(resultFile) ? readFileSync(resultFile, "utf8").trim() : null,
    );
  }

  resumeCommand(providerSessionId: string, o: RunOptions): CommandSpec {
    return this.command(["resume", providerSessionId], o.env);
  }

  async inventory(): Promise<Inventory> {
    return codexInventory();
  }
}
