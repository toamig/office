import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { DevServerState } from "../../../shared/models";
import type { Bus } from "../../core/bus";
import { portOpen } from "../../core/dev-server";
import { killTree, spawnResolved } from "../../core/exec";
import { splitCommand } from "../setup/mcp-test";

const MAX_LINES = 300;
const READY_TIMEOUT_MS = 180_000;
const URL_IN_OUTPUT = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})/i;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

interface Running {
  child: ReturnType<typeof spawnResolved>;
  command: string;
  port: number | null;
  output: string[];
  exitCode: number | null;
  ready: boolean;
  stopped: boolean;
  error: string | null;
  timer: NodeJS.Timeout | undefined;
}

export interface DevServerDeps {
  bus: Bus;
  /** The folder a session works in. */
  cwdOf: (sessionId: string) => string | undefined;
  isOpen?: (port: number) => Promise<boolean>;
  pollMs?: number;
}

/** The port a dev command usually listens on, when its script names a well-known tool. */
export function guessPort(script: string): number | null {
  if (/\bvite\b/.test(script)) return 5173;
  if (/\bnext\b|react-scripts|\bwebpack\b/.test(script)) return 3000;
  if (/\bastro\b/.test(script)) return 4321;
  if (/\bng\s+serve\b/.test(script)) return 4200;
  return null;
}

/** What the Preview tab starts by default: the folder's dev or start script. */
export function suggestCommand(cwd: string): { command: string; port: number | null } | null {
  try {
    const file = join(cwd, "package.json");
    if (!existsSync(file)) return null;
    const scripts = (JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
    const name = scripts["dev"] ? "dev" : scripts["start"] ? "start" : null;
    return name ? { command: name === "start" ? "npm start" : "npm run dev", port: guessPort(scripts[name] ?? "") } : null;
  } catch {
    return null;
  }
}

/**
 * Dev servers an agent or the owner started for a session. Office owns each process: its output is kept for the
 * panel, the page opens when the port answers, and it stops with its children when the session ends, is archived,
 * or the owner presses Stop.
 */
export class DevServers {
  private readonly running = new Map<string, Running>();
  private readonly last = new Map<string, { command: string; port: number | null }>();

  constructor(private readonly deps: DevServerDeps) {}

  state(sessionId: string): DevServerState {
    const server = this.running.get(sessionId);
    if (!server) {
      return { running: false, command: this.last.get(sessionId)?.command ?? null, port: null, url: null, output: [], exitCode: null, ready: false, error: null };
    }
    return {
      running: server.exitCode === null && !server.stopped, command: server.command, port: server.port,
      url: server.ready && server.port ? `http://localhost:${server.port}` : null,
      output: [...server.output], exitCode: server.exitCode, ready: server.ready, error: server.error,
    };
  }

  suggestion(sessionId: string): { command: string; port: number | null } | null {
    const cwd = this.deps.cwdOf(sessionId);
    return (cwd ? suggestCommand(cwd) : null) ?? this.last.get(sessionId) ?? null;
  }

  /** Starts a command in the session's folder (or a folder inside it) and opens its page when the port answers. */
  start(sessionId: string, request: { command: string; port?: number | null; folder?: string | undefined }): DevServerState {
    const base = this.deps.cwdOf(sessionId);
    if (!base) throw new Error("This session has no folder to run a server in.");
    const cwd = request.folder ? resolve(base, request.folder) : base;
    const inside = relative(base, cwd);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("A dev server can only run inside the session's folder.");
    const parts = splitCommand(request.command);
    if (!parts[0]) throw new Error("Enter the command that starts the server.");
    this.stop(sessionId);
    const port = request.port ?? null;
    const child = spawnResolved(parts[0], parts.slice(1), {
      cwd, env: { ...(port ? { PORT: String(port) } : {}), BROWSER: "none", FORCE_COLOR: "0" },
    }, true);
    const server: Running = {
      child, command: request.command.trim(), port, output: [], exitCode: null, ready: false, stopped: false, error: null, timer: undefined,
    };
    this.running.set(sessionId, server);
    this.last.set(sessionId, { command: server.command, port });
    const feed = (chunk: Buffer | string): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const text = line.replace(ANSI, "").trimEnd();
        if (!text) continue;
        server.output.push(text.slice(0, 500));
        if (server.output.length > MAX_LINES) server.output.shift();
        if (!server.port) {
          const match = URL_IN_OUTPUT.exec(text);
          if (match?.[1]) server.port = Number(match[1]);
        }
      }
      this.changed(sessionId);
    };
    child.stdout?.on("data", feed);
    child.stderr?.on("data", feed);
    child.stdin?.end();
    child.on("error", (error) => { server.error = error.message; server.exitCode = -1; this.finish(sessionId, server); });
    child.on("close", (code) => { server.exitCode = code ?? -1; this.finish(sessionId, server); });
    this.watchPort(sessionId, server);
    this.changed(sessionId);
    return this.state(sessionId);
  }

  stop(sessionId: string): void {
    const server = this.running.get(sessionId);
    if (!server) return;
    server.stopped = true;
    clearInterval(server.timer);
    if (server.exitCode === null) killTree(server.child, true);
    this.running.delete(sessionId);
    this.changed(sessionId);
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  private finish(sessionId: string, server: Running): void {
    clearInterval(server.timer);
    if (!server.ready && !server.stopped && !server.error)
      server.error = `The server stopped before it opened a page${server.exitCode ? ` (exit ${server.exitCode})` : ""}.`;
    this.changed(sessionId);
  }

  private watchPort(sessionId: string, server: Running): void {
    const started = Date.now();
    const isOpen = this.deps.isOpen ?? portOpen;
    server.timer = setInterval(() => {
      if (server.stopped || server.ready || server.exitCode !== null) return clearInterval(server.timer);
      if (Date.now() - started > READY_TIMEOUT_MS) {
        server.error = "The server did not open its page in time.";
        clearInterval(server.timer);
        return this.changed(sessionId);
      }
      if (!server.port) return;
      void isOpen(server.port).then((open) => {
        if (!open || server.ready || server.stopped) return;
        server.ready = true;
        clearInterval(server.timer);
        this.deps.bus.emit("chat.preview", { sessionId, url: `http://localhost:${server.port}` });
        this.changed(sessionId);
      });
    }, this.deps.pollMs ?? 500);
    server.timer.unref();
  }

  private changed(sessionId: string): void {
    this.deps.bus.emit("devserver.changed", { sessionId });
  }
}

/** A dev server stops with its session: when the session ends, fails or is archived. */
export function stopWithSession(bus: Bus, servers: Pick<DevServers, "stop">, archived: (sessionId: string) => boolean): () => void {
  return bus.on("session.status", (event) => {
    const { id, status } = event.payload as { id: string; status: string };
    if (status === "exited" || status === "failed" || archived(id)) servers.stop(id);
  });
}
