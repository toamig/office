import type { Inventory } from "../../../shared/models";
import type { Role } from "../../../shared/types";

export interface RunOptions {
  cwd: string;
  role?: Role;
  officeSessionId: string;
  addDirs?: string[];
  /** Folder for run output (Codex writes its result file here). */
  runDir?: string;
  /** Extra environment for the child process. */
  env?: Record<string, string>;
}

/** Normalised events from a headless run. */
export type AgentEvent =
  | { kind: "session"; providerSessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string }
  | { kind: "result"; text: string; ok: boolean }
  | { kind: "error"; message: string };

export interface AgentRunResult {
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
}

/** Set by the sessions module so providers can open their login in a terminal tab. */
export type TerminalOpener = (spec: CommandSpec, title: string) => void;
