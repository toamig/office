import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as pty from "node-pty";
import type { CommandSpec } from "../providers/types";
import { CLAUDE_TOKEN_ENV, claudeTerminalOutput } from "../../core/claude-secret";
import { stripVTControlCharacters } from "node:util";

const HISTORY_CHARS = 1_000_000;
const LOG_LIMIT_BYTES = 5 * 1024 * 1024;

export interface PtyEvents {
  onData: (id: string, data: string, end: number) => void;
  onExit: (id: string, code: number) => void;
}

interface Entry {
  proc: pty.IPty;
  history: string;
  total: number;
  logPath: string;
  logBytes: number;
  exited: boolean;
}

/** Owns the pseudo terminals: ConPTY on Windows, a pty elsewhere. */
export class PtyManager {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly logsDir: string,
    private readonly events: PtyEvents,
  ) {
    mkdirSync(logsDir, { recursive: true });
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  isRunning(id: string): boolean {
    const entry = this.entries.get(id);
    return Boolean(entry && !entry.exited);
  }

  spawn(
    id: string,
    spec: CommandSpec,
    opts: { cwd: string; cols?: number; rows?: number; env?: Record<string, string> },
  ): number {
    const logPath = join(this.logsDir, `${id}.log`);
    const proc = pty.spawn(spec.cmd, spec.args, {
      name: "xterm-256color",
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd,
      env: { ...process.env, ...spec.env, ...opts.env, TERM: "xterm-256color" } as Record<
        string,
        string
      >,
    });
    const entry: Entry = {
      proc,
      history: "",
      total: 0,
      logPath,
      logBytes: existsSync(logPath) ? statSync(logPath).size : 0,
      exited: false,
    };
    this.entries.set(id, entry);
    const redact = claudeTerminalOutput(opts.env?.[CLAUDE_TOKEN_ENV] ?? spec.env?.[CLAUDE_TOKEN_ENV]);
    let tail = "";
    const accept = (data: string) => {
      if (!data) return;
      if (spec.authFailure) {
        tail = (tail + stripVTControlCharacters(data)).slice(-1500);
        const failure = /(?:oauth session expired[^\r\n]*|not (?:logged|signed) in[^\r\n]*|(?:api error: )?401[^\r\n]*(?:authentication|unauthorized)[^\r\n]*)/i.exec(tail);
        if (failure) {
          spec.authFailure(failure[0]);
          tail = "";
        }
      }
      entry.history += data;
      entry.total += data.length;
      if (entry.history.length > HISTORY_CHARS) entry.history = entry.history.slice(-HISTORY_CHARS);
      this.log(entry, data);
      this.events.onData(id, data, entry.total);
    };
    proc.onData((data) => accept(redact(data)));
    proc.onExit(({ exitCode }) => {
      accept(redact("", true));
      entry.exited = true;
      this.events.onExit(id, exitCode);
    });
    return proc.pid;
  }

  /** Output so far (the last million characters) and the running total it ends at. */
  history(id: string): { data: string; upTo: number } {
    const entry = this.entries.get(id);
    return entry ? { data: entry.history, upTo: entry.total } : { data: "", upTo: 0 };
  }

  write(id: string, data: string): void {
    const entry = this.entries.get(id);
    if (entry && !entry.exited) entry.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id);
    if (entry && !entry.exited && cols > 0 && rows > 0) {
      try {
        entry.proc.resize(Math.floor(cols), Math.floor(rows));
      } catch {
        /* the process may have just ended */
      }
    }
  }

  kill(id: string): void {
    const entry = this.entries.get(id);
    if (entry && !entry.exited) {
      try {
        entry.proc.kill();
      } catch {
        /* already gone */
      }
    }
  }

  /** Forgets a finished terminal's in-memory history (the log file stays). */
  release(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.exited) this.entries.delete(id);
  }

  killAll(): void {
    for (const id of this.entries.keys()) this.kill(id);
  }

  /** Appends to the session log and rotates it at 5 MB (the old log becomes <id>.log.1). */
  private log(entry: Entry, data: string): void {
    try {
      if (entry.logBytes > LOG_LIMIT_BYTES) {
        const old = `${entry.logPath}.1`;
        if (existsSync(old)) unlinkSync(old);
        renameSync(entry.logPath, old);
        entry.logBytes = 0;
      }
      appendFileSync(entry.logPath, data, "utf8");
      entry.logBytes += Buffer.byteLength(data);
    } catch {
      /* a full disk must not kill the terminal */
    }
  }
}
