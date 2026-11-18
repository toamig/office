import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  input?: string;
}

export interface RunResult {
  /** Exit code, or -1 when the process could not start or was killed by the timeout. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

const toolCache = new Map<string, string | null>();

/** Forgets cached tool locations. Tests use it after changing PATH. */
export function clearToolCache(): void {
  toolCache.clear();
}

function pathExts(): string[] {
  if (process.platform !== "win32") return [""];
  const exts = (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return ["", ...exts.map((e) => e.toLowerCase())];
}

/** A `which`-style lookup: the absolute path of a command on PATH, or null. Cached. */
export function resolveTool(name: string): string | null {
  const override = process.env[`OFFICE_BIN_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
  if (override) return override;
  if (toolCache.has(name)) return toolCache.get(name) ?? null;
  let found: string | null = null;
  const dirs = (process.env["PATH"] ?? process.env["Path"] ?? "").split(delimiter).filter(Boolean);
  outer: for (const dir of dirs) {
    for (const ext of pathExts()) {
      const candidate = join(dir, name + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          // On Windows a bare name (no extension) is usually an npm shell shim; prefer the real one.
          if (process.platform === "win32" && ext === "" && extname(name) === "") continue;
          found = candidate;
          break outer;
        }
      } catch {
        /* unreadable entry, keep looking */
      }
    }
  }
  toolCache.set(name, found);
  return found;
}

/**
 * Turns a resolved tool path plus arguments into something execFile-safe without a shell:
 * scripts run through node, and npm `.cmd` shims are unwrapped to the script they launch.
 */
export function resolveCommand(file: string, args: string[]): { file: string; args: string[] } {
  const ext = extname(file).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return { file: resolveTool("node") ?? "node", args: [file, ...args] };
  }
  if (process.platform === "win32" && (ext === ".cmd" || ext === ".bat")) {
    const script = unwrapCmdShim(file);
    if (script) return { file: resolveTool("node") ?? "node", args: [script, ...args] };
    // Last resort for a hand-written .cmd: cmd.exe with verbatim, carefully quoted arguments.
    return {
      file: process.env["ComSpec"] ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${[file, ...args].map(quoteForCmd).join(" ")}"`],
    };
  }
  return { file, args };
}

function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""').replace(/%/g, "%%")}"`;
}

/** npm shims call `node "%dp0%\node_modules\pkg\bin\tool.js" %*`; find that script. */
function unwrapCmdShim(shim: string): string | null {
  try {
    const text = readFileSync(shim, "utf8");
    const match = /"%(?:~)?dp0%?\\([^"]+?\.(?:c|m)?js)"/i.exec(text);
    if (!match?.[1]) return null;
    const script = resolve(dirname(shim), match[1]);
    return existsSync(script) ? script : null;
  } catch {
    return null;
  }
}

function spawnResolved(cmd: string, args: string[], opts: RunOptions): ChildProcess {
  const tool = cmd.includes("/") || cmd.includes("\\") ? cmd : (resolveTool(cmd) ?? cmd);
  const resolved = resolveCommand(tool, args);
  return spawn(resolved.file, resolved.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
    windowsHide: true,
    windowsVerbatimArguments:
      process.platform === "win32" && resolved.file.toLowerCase().endsWith("cmd.exe"),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Runs a command without a shell. Never rejects: failures come back as code -1 with a message. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawnResolved(cmd, args, opts);
    } catch (err) {
      resolvePromise({ code: -1, stdout: "", stderr: (err as Error).message, timedOut: false });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const finish = (code: number, extra = ""): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8") + extra,
        timedOut,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      finish(-1, "timed out");
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => finish(-1, e.message));
    child.on("close", (code) => finish(code ?? -1));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(opts.input ?? "");
  });
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

export interface StreamHandle {
  /** stdout split into lines, as they arrive. */
  lines: AsyncIterable<string>;
  /** Resolves when the process exits. */
  exit: Promise<{ code: number; stderr: string }>;
  kill(): void;
}

/** Starts a command and yields its stdout line by line (for JSON-lines output). */
export function spawnStream(cmd: string, args: string[], opts: RunOptions = {}): StreamHandle {
  const child = spawnResolved(cmd, args, opts);
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let buffer = "";
  let stderr = "";
  const push = (line: string): void => {
    queue.push(line);
    wake?.();
  };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      push(buffer.slice(0, index).replace(/\r$/, ""));
      buffer = buffer.slice(index + 1);
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d: string) => (stderr += d));
  const exit = new Promise<{ code: number; stderr: string }>((done) => {
    const end = (code: number, extra = ""): void => {
      if (buffer) push(buffer);
      buffer = "";
      ended = true;
      wake?.();
      done({ code, stderr: stderr + extra });
    };
    child.on("error", (e) => end(-1, e.message));
    child.on("close", (code) => end(code ?? -1));
  });
  child.stdin?.on("error", () => undefined);
  if (opts.input !== undefined) child.stdin?.end(opts.input);
  else child.stdin?.end();
  async function* iterate(): AsyncGenerator<string> {
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (ended) return;
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
  }
  return { lines: iterate(), exit, kill: () => killTree(child) };
}
