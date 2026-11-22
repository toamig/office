import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  ChatEvent,
  ChatImage,
  ChatLine,
  ChatOptions,
  ChatState,
  OfficeBrief,
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
import { chatFailure } from "../../../shared/chat-failure";
import { redactClaudeToken } from "../../core/claude-secret";
import { ClaudeCodeProvider } from "../providers/claude-code";

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

/** What a new saved chat is called until its first message names it. */
export const NEW_CHAT = "New chat";

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
  authFailure?: (message: string) => void;
  credentialRevision?: number;
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
  /** What an incognito chat has said: kept in memory only, never in a file. */
  private readonly memory = new Map<string, ChatLine[]>();
  private readonly unsavedImages = new Map<string, Map<string, ChatImage[]>>();
  private readonly incognitoDirs = new Map<string, string[]>();
  /** Chats that were configured as incognito or restricted, by id (their config is not written for incognito). */
  private readonly secret = new Map<string, { restricted: boolean; incognito: boolean }>();

  constructor(private readonly deps: ChatServiceDeps) {}

  // ---------- storage ----------

  private dir(id: string): string {
    // An incognito chat keeps even its working files in its own temporary folder, which is deleted on close.
    const incognito = this.secret.get(id)?.incognito === true;
    const dir = incognito
      ? join(this.deps.sessions.get(id).cwd, ".chat")
      : join(this.deps.chatsDir, id);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private logFile(id: string): string {
    return join(this.dir(id), "chat.jsonl");
  }

  history(id: string): ChatLine[] {
    const kept = this.memory.get(id);
    if (kept) return kept;
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
    const memory = this.memory.get(id);
    // An incognito chat's words stay in memory; nothing about it is written to a file.
    if (memory) memory.push(line);
    else appendFileSync(this.logFile(id), `${JSON.stringify(line)}\n`);
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
  configure(
    id: string,
    extra: { addDirs?: string[]; restricted?: boolean; incognito?: boolean },
  ): void {
    this.secret.set(id, {
      restricted: extra.restricted === true,
      incognito: extra.incognito === true,
    });
    if (extra.incognito) {
      // Nothing about an incognito chat is written to the app's data: its words stay in memory.
      this.memory.set(id, []);
      this.incognitoDirs.set(id, extra.addDirs ?? []);
      return;
    }
    writeTextFile(join(this.dir(id), "config.json"), `${JSON.stringify(extra, null, 2)}\n`);
  }

  /** Turns incognito off: what was said so far is written to the chat's log, and it is an ordinary chat from now on. */
  keep(id: string): void {
    const kept = this.memory.get(id);
    const flags = this.secret.get(id);
    if (!kept || !flags) return;
    this.memory.delete(id);
    this.secret.set(id, { restricted: flags.restricted, incognito: false });
    const dirs = this.incognitoDirs.get(id) ?? [];
    this.incognitoDirs.delete(id);
    for (const [message, images] of this.unsavedImages.get(id) ?? [])
      this.saveImages(id, message, images);
    this.unsavedImages.delete(id);
    writeTextFile(
      join(this.dir(id), "config.json"),
      `${JSON.stringify({ addDirs: dirs, restricted: flags.restricted }, null, 2)}\n`,
    );
    for (const line of kept) appendFileSync(this.logFile(id), `${JSON.stringify(line)}\n`);
  }

  /** Forgets everything about an incognito chat: its words, its process and its options. */
  forget(id: string): void {
    this.stop(id);
    this.memory.delete(id);
    this.unsavedImages.delete(id);
    this.secret.delete(id);
    this.incognitoDirs.delete(id);
    this.seqs.delete(id);
    this.live.delete(id);
  }

  /** Whether the chat reads the brain and the web only (Chat), from what it was started with. */
  private restricted(id: string): boolean {
    const known = this.secret.get(id);
    if (known) return known.restricted;
    try {
      const config = JSON.parse(readFileSync(join(this.dir(id), "config.json"), "utf8")) as {
        restricted?: boolean;
      };
      return config.restricted === true;
    } catch {
      return false;
    }
  }

  private addDirs(id: string): string[] {
    const kept = this.incognitoDirs.get(id);
    if (kept) return kept;
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
    const catalog = await provider?.chatModels?.(row.cwd);
    const options = this.options(id);
    const roleModel = options.model === undefined ? this.deps.sessions.roleForAgent(row).model : undefined;
    const defaultModel = roleModel
      ? catalog?.models.find((entry) => entry.id === roleModel) ?? { id: roleModel, label: roleModel, efforts: [] }
      : catalog?.defaultModel;
    return {
      mode: row.mode,
      kind,
      working: this.working(id),
      models: catalog?.models ?? [],
      defaultModel,
      options,
    };
  }

  private permission(row: SessionRow, kind: "claude" | "codex", officeMcp = false): RunPermission {
    const role = this.deps.sessions.roleForAgent(row);
    if (role.readOnly || this.restricted(row.id)) return { kind: "readonly" };
    if (role.autonomy === "full-auto") return { kind: "full" };
    if (kind === "codex" || officeMcp) return { kind: "ask" };
    return { kind: "ask", mcpConfig: this.deps.writeMcpConfig(row.id, this.dir(row.id)) };
  }

  // ---------- sending ----------

  /** Sends the owner's message: starts the program if it is not running, and records the message. */
  send(id: string, text: string, images: ChatImage[] = [], options?: ChatOptions, brief?: OfficeBrief): void {
    const row = this.session(id);
    if (row.mode !== "chat") throw new IpcFailure("not-chat", "This session is open in a terminal");
    if (this.working(id)) throw new IpcFailure("busy", "A turn is still running. Stop it first.");
    const provider = this.deps.providers.get(row.provider);
    if (!provider?.chatCommand) throw new IpcFailure("no-chat", "This tool has no chat mode");
    if (options) this.setOptions(id, options);
    const picked = this.options(id);
    const message = randomUUID();
    if (images.length) this.saveImages(id, message, images);
    text = redactClaudeToken(text);
    this.append(id, { t: "user", id: message, text, images: images.length, ...(brief ? { brief } : {}) });
    this.append(id, { t: "turn-start" });
    this.deps.sessions.setStatus(id, "working");

    this.nameFromFirstMessage(row, text);
    const kind = provider.chatKind ?? "claude";
    if (kind === "claude") {
      let live = this.live.get(id);
      if (live && provider instanceof ClaudeCodeProvider && live.credentialRevision !== provider.auth.revision) {
        this.endIdle(id, live);
        live = undefined;
      }
      if (!live) live = this.startClaude(id, row, provider, { text, images, attempts: 1 });
      live.working = true;
      live.started = Date.now();
      live.turn = { text, images, attempts: 1 };
      live.handle.write(JSON.stringify(userMessage(text, images)));
      return;
    }
    // Codex: one program per turn.
    const threadId = row.providerSessionId ?? undefined;
    const brain = this.deps.sessions.brainForSession(row);
    const officeMcp = this.deps.sessions.officeMcpForSession(row);
    const spec = provider.chatCommand({
      cwd: row.cwd,
      officeSessionId: id,
      resume: Boolean(threadId),
      ...(this.restricted(id) ? { restricted: true } : {}),
      role: this.deps.sessions.roleForAgent(row),
      permission: this.permission(row, kind),
      ...(brain ? { brain } : {}),
      ...(officeMcp ? { officeMcp } : {}),
      model: picked.model,
      effort: picked.effort,
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

  private saveImages(id: string, message: string, images: ChatImage[]): void {
    if (this.memory.has(id)) {
      const saved = this.unsavedImages.get(id) ?? new Map<string, ChatImage[]>();
      saved.set(message, images);
      this.unsavedImages.set(id, saved);
      return;
    }
    writeTextFile(join(this.dir(id), `${message}.images.json`), JSON.stringify(images));
  }

  resend(id: string, messageId: string, text?: string, useDefault?: boolean): void {
    const messages = this.history(id).flatMap(({ event }) => event.t === "user" ? [event] : []);
    const message = messages.find((event) => event.id === messageId);
    if (!message || (text !== undefined && (message.brief || messages.at(-1) !== message)))
      throw new IpcFailure("no-message", "That message is unavailable to resend.");
    let images = this.unsavedImages.get(id)?.get(messageId) ?? [];
    if (message.images && !images.length && /^[0-9a-f-]{36}$/.test(messageId)) {
      try {
        images = JSON.parse(readFileSync(join(this.dir(id), `${messageId}.images.json`), "utf8")) as ChatImage[];
      } catch { /* Older conversations saved only the count. */ }
    }
    if (message.images && !images.length)
      throw new IpcFailure("no-images", "Attach the images again to resend this message.");
    this.send(id, text ?? message.text, images, useDefault ? { model: "", effort: "" } : undefined, message.brief);
  }

  /** A saved chat is named by its first message, so the list reads as what each was about. */
  private nameFromFirstMessage(row: SessionRow, text: string): void {
    if (row.title !== NEW_CHAT || row.incognito) return;
    const name = text.replace(/\s+/g, " ").trim();
    if (!name) return;
    this.deps.sessions.rename(
      row.id,
      name.length > 60 ? `${name.slice(0, 57).trimEnd()}...` : name,
    );
  }

  /** Starts the program of a Claude chat. It is resumed if its conversation exists, and started fresh if not. */
  private startClaude(
    id: string,
    row: SessionRow,
    provider: Provider,
    turn: NonNullable<Live["turn"]>,
  ): Live {
    const picked = this.options(id);
    const restricted = this.restricted(id);
    const incognito = this.secret.get(id)?.incognito === true;
    const brain = this.deps.sessions.brainForSession(row);
    const officeMcp = this.deps.sessions.officeMcpForSession(row);
    const spec = provider.chatCommand!({
      cwd: row.cwd,
      officeSessionId: id,
      resume: row.conversationStarted,
      ...(restricted ? { restricted: true } : {}),
      ...(incognito ? { incognito: true } : {}),
      role: this.deps.sessions.roleForAgent(row),
      permission: this.permission(row, "claude", Boolean(officeMcp)),
      ...(brain ? { brain } : {}),
      ...(officeMcp ? { officeMcp } : {}),
      model: picked.model,
      effort: picked.effort,
      runDir: this.dir(id),
      addDirs: this.addDirs(id),
    });
    const handle = spawnStream(spec.cmd, spec.args, {
      cwd: row.cwd,
      ...(spec.env ? { env: spec.env } : {}),
      keepStdin: true,
      prepare: spec.prepare,
    });
    const live: Live = {
      handle,
      working: true,
      stopped: false,
      kind: "claude",
      started: Date.now(),
      turn,
      authFailure: spec.authFailure,
      credentialRevision: provider instanceof ClaudeCodeProvider ? provider.auth.revision : undefined,
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
        ok: exit.code === 0 && !parser.failed,
        durationMs: Date.now() - live.started,
        ...(exit.code === 0 && !parser.failed
          ? {}
          : { error: parser.failed || exit.stderr.trim().slice(-4000) || `exit ${exit.code}` }),
      });
    }
    await this.ended(id, live);
  }

  /** Records one event; a result ends the turn. */
  private take(id: string, live: Live, event: ChatEvent): void {
    if (live.stopped || !live.working) return;
    this.append(id, event);
    if (event.t === "result" || event.t === "error") {
      live.working = false;
      const failure = event.t === "error" ? event.message : !event.ok ? event.error : undefined;
      if (failure) this.authFailure(id, live, failure);
      if (event.t === "result") this.deps.sessions.setStatus(id, "idle");
      else this.deps.sessions.setStatus(id, "idle", event.message);
    }
  }

  private authFailure(id: string, live: Live, failure: string): void {
    if (chatFailure(failure, "Claude Code").kind !== "login") return;
    live.authFailure?.(failure);
    if (live.kind === "claude") this.endIdle(id, live);
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
      const message = exit.stderr.trim().slice(-4000) || `The program stopped (exit code ${exit.code}).`;
      this.authFailure(id, live, message);
      this.append(id, { t: "error", message });
      this.deps.sessions.setStatus(id, "idle");
    }
    this.deps.bus.emit("chat.state", { sessionId: id });
  }

  /**
   * Remembers the model and permission mode picked in the header. They are flags of the program, so an idle
   * program is ended quietly and the next message starts it again, with --resume, under the new flags.
   */
  setOptions(id: string, options: ChatOptions): void {
    this.session(id);
    if (this.working(id)) throw new IpcFailure("busy", "Stop the current turn before changing options.");
    const before = this.options(id);
    const next: ChatOptions = { ...before, ...options };
    if (before.model !== next.model && options.effort === undefined) next.effort = "";
    this.saveOptions(id, next);
    const live = this.live.get(id);
    if (live?.kind === "claude") this.endIdle(id, live);
    this.deps.bus.emit("chat.state", { sessionId: id });
  }

  private endIdle(id: string, live: Live): void {
    live.stopped = true;
    if (this.live.get(id) === live) this.live.delete(id);
    live.handle.kill();
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
