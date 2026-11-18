import type { ToolStatus } from "../../../shared/models";
import { resolveTool, run, type RunResult } from "../../core/exec";

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";
const versionOf = (text: string): string | undefined => /(\d+\.\d+\.\d+[^\s]*)/.exec(text)?.[1];

async function probe(cmd: string, args: string[]): Promise<RunResult | null> {
  if (!resolveTool(cmd)) return null;
  return run(cmd, args, { timeoutMs: 20_000 });
}

const missing = (id: string, label: string, fix: string): ToolStatus => ({
  id,
  label,
  installed: false,
  loggedIn: null,
  problem: `${label} was not found on PATH`,
  fix,
});

async function detectSimple(
  id: string,
  label: string,
  cmd: string,
  fix: string,
): Promise<ToolStatus> {
  const result = await probe(cmd, ["--version"]);
  if (!result || result.code !== 0) return missing(id, label, fix);
  const version = versionOf(result.stdout);
  return { id, label, installed: true, loggedIn: null, ...(version ? { version } : {}) };
}

async function detectGh(): Promise<ToolStatus> {
  const version = await probe("gh", ["--version"]);
  if (!version || version.code !== 0) {
    return missing(
      "gh",
      "GitHub CLI",
      "Install it from https://cli.github.com, then run: gh auth login",
    );
  }
  const auth = await run("gh", ["auth", "status"], { timeoutMs: 20_000 });
  const v = versionOf(version.stdout);
  return {
    id: "gh",
    label: "GitHub CLI",
    installed: true,
    loggedIn: auth.code === 0,
    ...(v ? { version: v } : {}),
    ...(auth.code === 0 ? {} : { problem: "Not logged in to GitHub", fix: "Run: gh auth login" }),
  };
}

/** `claude auth status` prints JSON with a loggedIn flag; anything else counts as logged out. */
export function parseLoggedIn(stdout: string): boolean {
  try {
    return (JSON.parse(stdout) as { loggedIn?: boolean }).loggedIn === true;
  } catch {
    return false;
  }
}

/** Claude Code (plan 7.2): `claude --version` and `claude auth status` (JSON with loggedIn). */
export async function detectClaude(bin = "claude", id = "claude-code"): Promise<ToolStatus> {
  const fix =
    "Install Claude Code from https://claude.com/claude-code, then run: claude auth login";
  const version = await probe(bin, ["--version"]);
  if (!version || version.code !== 0) return missing(id, "Claude Code", fix);
  const v = versionOf(version.stdout);
  const auth = await run(bin, ["auth", "status"], { timeoutMs: 20_000 });
  const loggedIn = parseLoggedIn(auth.stdout);
  return {
    id,
    label: "Claude Code",
    installed: true,
    loggedIn,
    ...(v ? { version: v } : {}),
    ...(loggedIn ? {} : { problem: "Not logged in to Claude Code", fix: "Run: claude auth login" }),
  };
}

/**
 * Codex (plan 7.3): `codex --version` and `codex login status`. A failure that starts with
 * "Error loading configuration" means the CLI is older than the config the desktop app wrote.
 */
export async function detectCodex(bin = "codex"): Promise<ToolStatus> {
  const fix = "Install Codex with: npm i -g @openai/codex, then run: codex login";
  const version = await probe(bin, ["--version"]);
  if (!version || version.code !== 0) return missing("codex", "Codex", fix);
  const v = versionOf(version.stdout);
  const status = await run(bin, ["login", "status"], { timeoutMs: 20_000 });
  const output = `${status.stderr}\n${status.stdout}`.trim();
  const base = { id: "codex", label: "Codex", installed: true, ...(v ? { version: v } : {}) };
  if (status.code !== 0 && output.startsWith("Error loading configuration")) {
    return {
      ...base,
      loggedIn: null,
      problem: "Codex CLI is older than your config; update it with npm i -g @openai/codex",
      fix: "Run: npm i -g @openai/codex",
    };
  }
  const loggedIn = status.code === 0 && /logged in/i.test(output);
  return {
    ...base,
    loggedIn,
    ...(loggedIn
      ? {}
      : { problem: firstLine(output) || "Not logged in to Codex", fix: "Run: codex login" }),
  };
}

/** Everything Setup shows in its tools table. */
export async function detectTools(): Promise<ToolStatus[]> {
  return Promise.all([
    detectSimple("git", "Git", "git", "Install Git from https://git-scm.com"),
    detectGh(),
    detectSimple("node", "Node.js", "node", "Install Node.js 22 or newer from https://nodejs.org"),
    detectClaude(),
    detectCodex(),
  ]);
}
