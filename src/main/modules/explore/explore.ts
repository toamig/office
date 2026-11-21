import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { SessionRow, SpawnInput, SpawnReport, SpawnStep } from "../../../shared/models";
import type { Bus } from "../../core/bus";
import { IpcFailure } from "../../core/ipc";
import { NEW_CHAT } from "../chat/service";
import type { SessionService } from "../sessions/service";
import { createNotesRepo, planSpawn, runSpawn, type SpawnDeps } from "./spawn";

/** What the sessions of Chat carry as their role label (older explorations carry "explore"). */
export const CHAT_LABEL = "chat";
const CHAT_LABELS = [CHAT_LABEL, "explore"];

export interface ExploreDeps {
  sessions: SessionService;
  bus: Bus;
  exploreDir: string;
  workspaceRoot: () => string;
  spawn: Omit<SpawnDeps, "providerOf" | "onProgress" | "transcriptOf">;
}

/**
 * Chat: a plain conversation that can read the brain and the web and cannot run or edit anything, and the wizard that
 * turns one into a project. A saved chat lives in the app's data folder; an incognito one in a temporary folder that is
 * deleted when it is closed, and it is never listed.
 */
export class ExploreService {
  constructor(private readonly deps: ExploreDeps) {}

  /** A chat session in its own folder, with the brain added for reading. */
  start(providerId = "claude-code", incognito = false, projectId?: string): SessionRow {
    const id = randomUUID();
    const dir = incognito
      ? mkdtempSync(join(tmpdir(), "office-chat-"))
      : join(this.deps.exploreDir, id);
    mkdirSync(dir, { recursive: true });
    const root = this.deps.workspaceRoot();
    return this.deps.sessions.start(
      {
        providerId,
        cwd: dir,
        title: incognito ? "Incognito chat" : NEW_CHAT,
        mode: "chat",
        ...(projectId && !incognito ? { projectId } : {}),
      },
      {
        ...(root ? { addDirs: [root] } : {}),
        roleLabel: CHAT_LABEL,
        restricted: true,
        incognito,
      },
    );
  }

  /** The saved chats, newest first. An incognito chat is never in the list. */
  list(): SessionRow[] {
    return this.deps.sessions
      .list({ includeArchived: false, chats: true })
      .filter((s) => CHAT_LABELS.includes(s.role ?? ""));
  }

  /** Ends a chat: an incognito one is erased (row, words, folder); a saved one is archived. */
  async close(id: string): Promise<void> {
    const session = this.deps.sessions.get(id);
    if (!session.incognito) {
      this.deps.sessions.archive(id);
      return;
    }
    this.deps.sessions.chat?.forget(id);
    this.deps.sessions.discardIncognito(id);
    await this.erase(session.cwd);
  }

  /** Turns incognito off: the chat becomes a saved one, its folder moves into the app's data and its words are kept. */
  async keep(id: string): Promise<SessionRow> {
    const session = this.deps.sessions.get(id);
    if (!session.incognito) return session;
    const dir = join(this.deps.exploreDir, id);
    mkdirSync(dir, { recursive: true });
    cpSync(session.cwd, dir, { recursive: true });
    this.deps.sessions.setCwd(id, dir);
    this.deps.sessions.chat?.keep(id);
    this.deps.sessions.keepIncognito(id);
    // The old folder is removed once the program that was running in it lets go; the chat does not wait for it.
    void this.erase(session.cwd);
    return this.deps.sessions.get(id);
  }

  /** Removes the folders of incognito chats a run left behind, and their rows. Called once at start. */
  clearLeftovers(): void {
    for (const cwd of this.deps.sessions.takeLeftoverIncognito()) void this.erase(cwd);
  }

  /** Only a folder this service made for an incognito chat is ever removed. It is retried while its program lets go. */
  private async erase(dir: string): Promise<void> {
    if (!dir.startsWith(join(tmpdir(), "office-chat-"))) return;
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
    } catch {
      /* nothing in it is worth a failure */
    }
  }

  /** What a chat said, as text for a summary: the owner's words and the answers, in order. */
  transcript(id: string): string | null {
    const session = this.deps.sessions.find(id);
    if (!session || session.incognito) return null;
    const lines = this.deps.sessions.chat?.history(id) ?? [];
    const out: string[] = [];
    for (const { event } of lines) {
      if (event.t === "user" && event.text) out.push(`Owner: ${event.text}`);
      else if (event.t === "assistant" && event.text) out.push(`Assistant: ${event.text}`);
    }
    const terminal = stripVTControlCharacters(this.deps.sessions.history(id).data).trim();
    return [out.join("\n\n"), terminal].filter(Boolean).join("\n\n").slice(-20_000) || null;
  }

  private spawnDeps(): SpawnDeps {
    return {
      ...this.deps.spawn,
      providerOf: (sessionId) =>
        sessionId ? (this.deps.sessions.find(sessionId)?.provider ?? "claude-code") : "claude-code",
      transcriptOf: (sessionId) => this.transcript(sessionId),
      onProgress: (steps) => this.deps.bus.emit("run.progress", { kind: "spawn", steps }),
    };
  }

  /** The checklist, shown before anything runs. */
  plan(input: SpawnInput): SpawnStep[] {
    return planSpawn(this.spawnDeps(), input);
  }

  /** A notes repo for an existing project, registered in the brain hub (adding projects). */
  notesRepo(name: string, domain: SpawnInput["domain"], stack: string): Promise<string> {
    return createNotesRepo(this.spawnDeps(), name, domain, stack);
  }

  async spawn(input: SpawnInput): Promise<SpawnReport> {
    if (input.visibility === "public" && !input.publicConfirmed) {
      throw new IpcFailure(
        "needs-confirm",
        "Creating a public repo needs its own explicit confirmation",
      );
    }
    const result = await runSpawn(this.spawnDeps(), input);
    const source = input.exploreSessionId ? this.deps.sessions.find(input.exploreSessionId) : undefined;
    if (result.ok && result.projectId && source && !source.projectId && CHAT_LABELS.includes(source.role ?? ""))
      this.deps.sessions.linkProject(source.id, result.projectId);
    return result;
  }
}
