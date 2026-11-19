import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ChatEvent,
  ChatImage,
  ChatLine,
  ChatOptions,
  ChatState,
  SessionRow,
} from "../../../shared/models";
import type { Bus } from "../../core/bus";
import { run, spawnStream, type StreamHandle } from "../../core/exec";
import { IpcFailure } from "../../core/ipc";
import { writeTextFile } from "../../core/settings";
import { nowIso } from "../../core/util";
import type { PermissionBroker } from "../runs/permissions";
import type { ProviderRegistry } from "../providers/registry";
import type { Provider, RunPermission } from "../providers/types";
import type { SessionService } from "../sessions/service";
import { ClaudeChatParser, CodexChatParser } from "./events";

export interface ChatServiceDeps {
  bus: Bus;
  providers: ProviderRegistry;
  sessions: SessionService;
  /** The folder holding one folder per chat (its events and options). */
  chatsDir: string;
  broker: PermissionBroker;
  /** Writes the MCP config that serves office_permission to this chat's program; returns its path. */
  writeMcpConfig: (id: string, dir: string) => string;
}

/** Claude Code's permission modes a chat can use; "default" sends no flag. */
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto"];

/** How many times a start that the program refuses over the conversation flag is tried, flipping the flag each time. */
const MAX_START_ATTEMPTS = 3;

interface Live {
  handle: StreamHandle;
  /** True while a turn runs in this process. */
  working: boolean;
  /** Set by Stop, so the exit that follows is not reported as a failure. */
  stopped: boolean;
  kind: "claude" | "codex";
  started: number;
  /** The message this process was started for, so a start with the wrong conversation flag can be redone. */
  turn?: { text: string; images: ChatImage[]; attempts: number };
}

/**
 * Agent conversations as chats (spec 4.3, plan 7.2 and 7.3): Claude Code keeps one program per chat that
 * takes messages as JSON lines and streams its answer back; Codex runs one program per turn. Their streams
 * become chat events, which are stored as JSON lines in the chat's folder, sent to the chat view, and
 * replayed when a past chat is reopened. Approvals use the same office_permission tool as builder stages.
 */
export class ChatService {
  private readonly live = new Map<string, Live>();
  private readonly seqs = new Map<string, number>();

  constructor(private readonly deps: ChatServiceDeps) {}

  // ---------- storage ----------

  private dir(id: string): string {
    const dir = join(this.deps.chatsDir, id);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private logFile(id: string): string {
    return join(this.dir(id), "chat.jsonl");
  }

  history(id: string): ChatLine[] {
    const file = join(this.deps.chatsDir, id, "chat.jsonl");
    if (!existsSync(file)) return [];
    const lines: ChatLine[] = [];
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      try {
        lines.push(JSON.parse(raw) as ChatLine);
      } catch {
        /* a half-written last line is skipped */
      }
    }
    return lines;
  }

  private append(id: string, event: ChatEvent): void {
    const session = this.deps.sessions.find(id);
    const seq = (this.seqs.get(id) ?? this.history(id).length) + 1;
    this.seqs.set(id, seq);
    const line: ChatLine = { seq, at: nowIso(), event };
    appendFileSync(this.logFile(id), `${JSON.stringify(line)}\n`);
    this.deps.bus.emit("chat.event", { sessionId: id, line }, session?.projectId ?? undefined);
  }

  private options(id: string): ChatOptions {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), "options.json"), "utf8")) as ChatOptions;
    } catch {
      return {};
    }
  }

  /** What a chat was started with that is not a header choice: the extra folders it may read. */
  configure(id: string, extra: { addDirs?: string[] }): void {
    writeTextFile(join(this.dir(id), "config.json"), `${JSON.stringify(extra, null, 2)}\n`);
  }

  private addDirs(id: string): string[] {
    try {
      const config = JSON.parse(readFileSync(join(this.dir(id), "config.json"), "utf8")) as {
        addDirs?: string[];
      };
      return config.addDirs ?? [];
    } catch {
      return [];
    }
  }

  private saveOptions(id: string, options: ChatOptions): void {
    writeTextFile(join(this.dir(id), "options.json"), `${JSON.stringify(options, null, 2)}\n`);
  }

  // ---------- state ----------

  private session(id: string): SessionRow {
    const row = this.deps.sessions.find(id);
    if (!row) throw new IpcFailure("not-found", `No session ${id}`);
    return row;
  }

  running(id: string): boolean {
    return this.live.has(id);
  }

  private working(id: string): boolean {
    return this.live.get(id)?.working ?? false;
  }

  async state(id: string): Promise<ChatState> {
    const row = this.session(id);
    const provider = this.deps.providers.get(row.provider);
    const kind = provider?.chatKind ?? "claude";
    const role = row.role ? this.role(row) : undefined;
    return {
      mode: row.mode,
      kind,
      working: this.working(id),
      sandbox: kind === "codex" ? (role?.readOnly ? "read-only" : "workspace-write") : "",
      models: provider ? await provider.models() : [],
      permissionModes: kind === "claude" ? PERMISSION_MODES : [],
      options: this.options(id),
    };
  }

  private role(row: SessionRow) {
    try {
      return row.role
        ? this.deps.sessions.resolveRole(row.role, row.projectId ?? undefined)
        : undefined;
    } catch {
      return undefined;
    }
  }

  // ---------- sending ----------

  /** Sends the owner's message: starts the program if it is not running, and records the message. */
  send(id: string, text: string, images: ChatImage[] = [], options?: ChatOptions): void {
    const row = this.session(id);
    if (row.mode !== "chat") throw new IpcFailure("not-chat", "This session is open in a terminal");
    if (this.working(id)) throw new IpcFailure("busy", "A turn is still running. Stop it first.");
    const provider = this.deps.providers.get(row.provider);
    if (!provider?.chatCommand) throw new IpcFailure("no-chat", "This tool has no chat mode");
    if (options) this.saveOptions(id, { ...this.options(id), ...options });
    const picked = this.options(id);
    this.append(id, { t: "user", id: `u${Date.now()}`, text, images: images.length });
    this.append(id, { t: "turn-start" });
    this.deps.sessions.setStatus(id, "working");

    const role = this.role(row);
    const permission: RunPermission = role?.readOnly
      ? { kind: "readonly" }
      : { kind: "ask", mcpConfig: this.deps.writeMcpConfig(id, this.dir(id)) };
    const kind = provider.chatKind ?? "claude";
    if (kind === "claude") {
      let live = this.live.get(id);
      if (!live) live = this.startClaude(id, row, provider, { text, images, attempts: 1 });
      live.working = true;
      live.handle.write(JSON.stringify(userMessage(text, images)));
      return;
    }
    // Codex: one program per turn.
    const threadId = row.providerSessionId ?? undefined;
    const spec = provider.chatCommand({
      cwd: row.cwd,
      officeSessionId: id,
      resume: Boolean(threadId),
      ...(role ? { role } : {}),
      permission,
      ...(picked.model ? { model: picked.model } : {}),
      message: text,
      ...(threadId ? { threadId } : {}),
      runDir: this.dir(id),
    });
    const handle = spawnStream(spec.cmd, spec.args, {
      cwd: row.cwd,
      ...(spec.env ? { env: spec.env } : {}),
    });
    const live: Live = { handle, working: true, stopped: false, kind, started: Date.now() };
    this.live.set(id, live);
    void this.readCodex(id, live);
  }

  /** Starts the program of a Claude chat. It is resumed if its conversation exists, and started fresh if not. */
  private startClaude(
    id: string,
    row: SessionRow,
    provider: Provider,
    turn: NonNullable<Live["turn"]>,
  ): Live {
    const picked = this.options(id);
    const role = this.role(row);
    const permission: RunPermission = role?.readOnly
      ? { kind: "readonly" }
      : { kind: "ask", mcpConfig: this.deps.writeMcpConfig(id, this.dir(id)) };
    const spec = provider.chatCommand!({
      cwd: row.cwd,
      officeSessionId: id,
      resume: row.conversationStarted,
      ...(role ? { role } : {}),
      permission,
      ...(picked.model ? { model: picked.model } : {}),
      ...(picked.permissionMode && picked.permissionMode !== "default"
        ? { permissionMode: picked.permissionMode }
        : {}),
      runDir: this.dir(id),
      addDirs: this.addDirs(id),
    });
    const handle = spawnStream(spec.cmd, spec.args, {
      cwd: row.cwd,
      ...(spec.env ? { env: spec.env } : {}),
      keepStdin: true,
    });
    const live: Live = {
      handle,
      working: true,
      stopped: false,
      kind: "claude",
      started: Date.now(),
      turn,
    };
    this.live.set(id, live);
    // A process for this conversation has run, so from now on it is resumed, never started again.
    this.deps.sessions.markStarted(id);
    void this.readClaude(id, live);
    return live;
  }

  private async readClaude(id: string, live: Live): Promise<void> {
    const parser = new ClaudeChatParser();
    for await (const line of live.handle.lines) {
      for (const event of parser.parse(line)) this.take(id, live, event);
    }
    await this.ended(id, live);
  }

  private async readCodex(id: string, live: Live): Promise<void> {
    const parser = new CodexChatParser();
    let sawResult = false;
    for await (const line of live.handle.lines) {
      const before = parser.threadId;
      for (const event of parser.parse(line)) {
        if (event.t === "result") sawResult = true;
        this.take(id, live, event);
      }
      if (parser.threadId && parser.threadId !== before) {
        this.deps.sessions.setProviderSessionId(id, parser.threadId);
      }
    }
    const exit = await live.handle.exit;
    if (!sawResult && !live.stopped) {
      this.take(id, live, {
        t: "result",
        ok: exit.code === 0,
        durationMs: Date.now() - live.started,
        ...(exit.code === 0
          ? {}
          : { error: exit.stderr.trim().split("\n").pop() || `exit ${exit.code}` }),
      });
    }
    await this.ended(id, live);
  }

  /** Records one event; a result ends the turn. */
  private take(id: string, live: Live, event: ChatEvent): void {
    if (live.stopped) return;
    this.append(id, event);
    if (event.t === "result" || event.t === "error") {
      live.working = false;
      if (event.t === "result") this.deps.sessions.setStatus(id, "idle");
      else this.deps.sessions.setStatus(id, "idle", event.message);
    }
  }

  /** The program ended: report it if it ended in the middle of a turn, and free the slot. */
  private async ended(id: string, live: Live): Promise<void> {
    const exit = await live.handle.exit;
    if (this.live.get(id) === live) this.live.delete(id);
    // The program refused the conversation flag: it was started to resume a conversation that was never saved
    // (it was ended before it saved anything), or to start one that exists. Start it again the other way; a
    // program that was just stopped can still be saving as it dies, so the flag may need to turn more than once.
    const wrong = /No conversation found/i.test(exit.stderr)
      ? false
      : /already in use/i.test(exit.stderr)
        ? true
        : null;
    if (
      wrong !== null &&
      live.working &&
      !live.stopped &&
      live.turn &&
      live.turn.attempts < MAX_START_ATTEMPTS
    ) {
      const provider = this.deps.providers.get(this.session(id).provider);
      if (provider?.chatCommand) {
        this.deps.sessions.markStarted(id, wrong);
        const again = this.startClaude(id, this.session(id), provider, {
          ...live.turn,
          attempts: live.turn.attempts + 1,
        });
        again.handle.write(JSON.stringify(userMessage(live.turn.text, live.turn.images)));
        return;
      }
    }
    this.deps.broker.cancelRun(id);
    if (live.working && !live.stopped) {
      this.append(id, {
        t: "error",
        message:
          exit.stderr.trim().split("\n").pop() || `The program stopped (exit code ${exit.code}).`,
      });
      this.deps.sessions.setStatus(id, "idle");
    }
    this.deps.bus.emit("chat.state", { sessionId: id });
  }

  /**
   * Remembers the model and permission mode picked in the header. They are flags of the program, so an idle
   * program is ended quietly and the next message starts it again, with --resume, under the new flags.
   */
  setOptions(id: string, options: ChatOptions): void {
    const before = this.options(id);
    const next: ChatOptions = { ...before, ...options };
    // An empty model means "the default".
    if (next.model === "") delete next.model;
    this.saveOptions(id, next);
    const live = this.live.get(id);
    if (live && !live.working && live.kind === "claude") {
      live.stopped = true;
      this.live.delete(id);
      live.handle.kill();
    }
    this.deps.bus.emit("chat.state", { sessionId: id });
  }

  /** Stop ends the program and its children; the next message starts it again with --resume. */
  stop(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.stopped = true;
    const wasWorking = live.working;
    live.working = false;
    this.live.delete(id);
    live.handle.kill();
    this.deps.broker.cancelRun(id);
    if (wasWorking) this.append(id, { t: "stopped" });
    this.deps.sessions.setStatus(id, "idle");
    this.deps.bus.emit("chat.state", { sessionId: id });
  }

  /** An approval card opened or was answered: the chat needs the owner while one is open. */
  permissionWaiting(id: string, waiting: boolean): void {
    const row = this.deps.sessions.find(id);
    if (!row || row.mode !== "chat") return;
    if (waiting) this.deps.sessions.setStatus(id, "needs-you");
    else this.deps.sessions.setStatus(id, this.working(id) ? "working" : "idle");
  }

  // ---------- project files for @ ----------

  async files(id: string, query: string): Promise<string[]> {
    const row = this.session(id);
    const listed = await run(
      "git",
      ["-C", row.cwd, "ls-files", "--cached", "--others", "--exclude-standard"],
      {
        timeoutMs: 15_000,
      },
    );
    if (listed.code !== 0) return [];
    const needle = query.toLowerCase();
    return listed.stdout
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f && f.toLowerCase().includes(needle))
      .slice(0, 20);
  }

  // ---------- chat and terminal, one at a time ----------

  /** Opens the same provider conversation in a terminal (slash commands, logins, anything the chat lacks). */
  toTerminal(id: string): SessionRow {
    this.stop(id);
    this.deps.sessions.setMode(id, "terminal");
    return this.deps.sessions.resume(id);
  }

  /** Brings the conversation back to the chat; the terminal's program ends first. */
  async toChat(id: string): Promise<SessionRow> {
    await this.deps.sessions.stop(id);
    this.deps.sessions.setMode(id, "chat");
    this.deps.sessions.setStatus(id, "idle");
    return this.session(id);
  }
}

/** One message of the stream-json input: text, and an image block for each pasted image. */
export function userMessage(text: string, images: ChatImage[]): Record<string, unknown> {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        ...images.map((image) => ({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.data },
        })),
        { type: "text", text },
      ],
    },
    parent_tool_use_id: null,
  };
}
