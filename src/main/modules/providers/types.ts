import type { Inventory } from "../../../shared/models";
import type { Role } from "../../../shared/types";

/**
 * Who answers "may I run this?" in a headless run (spec 6.3, plan 9.5). Claude Code only; Codex runs in
 * its own sandbox and ignores it.
 * - readonly: read tools only, nothing ever asks.
 * - ask: the role's allowed commands run; anything else goes to Office through the MCP permission tool.
 * - allowlist: the role's allowed commands run; anything else is refused and named in the run log.
 */
export interface RunPermission {
  kind: "readonly" | "ask" | "allowlist";
  /** The MCP config that serves the permission tool (kind "ask" only). */
  mcpConfig?: string;
}

export interface RunOptions {
  /** How permission requests are handled in a headless run. */
  permission?: RunPermission;
  cwd: string;
  role?: Role;
  officeSessionId: string;
  addDirs?: string[];
  /** Folder for run output (Codex writes its result file here). */
  runDir?: string;
  /** Extra environment for the child process. */
  env?: Record<string, string>;
  /** Only these tools exist for a headless run, and anything else is refused without asking. */
  tools?: string;
}

/** Normalised events from a headless run. */
export type AgentEvent =
  | { kind: "session"; providerSessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string }
  | { kind: "result"; text: string; ok: boolean }
  | { kind: "error"; message: string }
  /** A tool the run asked for and did not get, because nobody could answer. */
  | { kind: "denied"; name: string; summary: string };

export interface AgentRunResult {
  /** Tools the run asked for and was refused because nobody could answer, as "Bash: rm -rf x". */
  denied?: string[];
  ok: boolean;
  resultText: string;
  providerSessionId?: string;
  error?: string;
}

export interface AgentRun {
  events: AsyncIterable<AgentEvent>;
  done: Promise<AgentRunResult>;
  cancel(): void;
}

export interface CommandSpec {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Detection {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  problem?: string;
}

/** What a provider needs to start (or continue) a chat (plan 7.2 and 7.3). */
export interface ChatCommandOptions {
  cwd: string;
  officeSessionId: string;
  /** True to continue a conversation that already exists. */
  resume: boolean;
  role?: Role;
  permission: RunPermission;
  /** The owner's picks in the chat header. */
  model?: string;
  permissionMode?: string;
  /** Codex runs one process per turn, so each carries its message and the thread to continue. */
  message?: string;
  threadId?: string;
  /** A folder for the turn's output file (Codex). */
  runDir: string;
  /** Extra folders the program may read (Explore adds the brain). */
  addDirs?: string[];
  /** Chat: only read and web tools, and Allowed commands only, so nothing can run or be edited. */
  restricted?: boolean;
  /** Nothing is kept by the program once the chat ends (`--no-session-persistence`). */
  incognito?: boolean;
}

/** What every agent tool answers, so adding a vendor is one module (plan 7.1). */
export interface Provider {
  id: string;
  label: string;
  /** True when `headless` can resume an interactive session by id (end-of-session capture needs it). */
  readonly canResumeHeadless: boolean;
  detect(): Promise<Detection>;
  /** Opens the tool's own login in a terminal tab. */
  login(): Promise<void>;
  /** The command that logs in, for callers that open the terminal themselves. */
  loginCommand(): CommandSpec;
  models(): Promise<string[]>;
  interactiveCommand(o: RunOptions): CommandSpec;
  headless(o: RunOptions & { prompt: string; resumeId?: string }): AgentRun;
  resumeCommand(providerSessionId: string, o: RunOptions): CommandSpec;
  inventory(projectPath?: string): Promise<Inventory>;
  /**
   * How this provider runs a chat: "claude" is one long-lived process per chat that takes messages on stdin,
   * "codex" is one process per turn. Absent when the provider has no chat.
   */
  chatKind?: "claude" | "codex";
  chatCommand?(o: ChatCommandOptions): CommandSpec;
}

/** Set by the sessions module so providers can open their login in a terminal tab. */
export type TerminalOpener = (spec: CommandSpec, title: string) => void;
