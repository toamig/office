import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { RelayServer } from "../../src/main/core/relay-server";
import { ClaudeChatParser, CodexChatParser } from "../../src/main/modules/chat/events";
import { ChatService, userMessage } from "../../src/main/modules/chat/service";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { writePermissionMcpConfig } from "../../src/main/modules/runs/mcp-config";
import { PermissionBroker } from "../../src/main/modules/runs/permissions";
import { SessionService } from "../../src/main/modules/sessions/service";
import {
  buildChat,
  formatDuration,
  reduceChat,
  emptyChat,
  toolSummary,
} from "../../src/shared/chat";
import type { ChatEvent } from "../../src/shared/models";
import type { Workspace } from "../../src/shared/types";

const fixtures = resolve(__dirname, "../fixtures");
const bridge = resolve(__dirname, "../../resources/relay/office-permission-mcp.mjs");
const saved = { ...process.env };

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  process.env["OFFICE_BIN_CODEX"] = join(fixtures, "bin/fake-codex.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-chat-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
  process.env["OFFICE_DATA"] = join(home, "office-data");
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

describe("the chat reducer", () => {
  const events: ChatEvent[] = [
    { t: "user", id: "u1", text: "hi", images: 0 },
    { t: "turn-start" },
    { t: "assistant-start", id: "m1" },
    { t: "text-delta", id: "m1", text: "Hel" },
    { t: "text-delta", id: "m1", text: "lo" },
  ];

  it("streams text into one assistant message and marks it finished by the final message", () => {
    const mid = buildChat(events);
    expect(mid.working).toBe(true);
    expect(mid.items[1]).toMatchObject({ kind: "assistant", text: "Hello", streaming: true });
    const done = reduceChat(mid, { t: "assistant", id: "m1", text: "Hello there", thinking: "" });
    expect(done.items).toHaveLength(2);
    expect(done.items[1]).toMatchObject({ text: "Hello there", streaming: false });
  });

  it("makes a card for a tool call, finishes it with its result, and never doubles a repeated call", () => {
    let s = buildChat(events);
    const call: ChatEvent = { t: "tool-use", id: "t1", name: "Bash", input: { command: "ls" } };
    s = reduceChat(reduceChat(s, call), call);
    expect(s.items.filter((i) => i.kind === "tool")).toHaveLength(1);
    s = reduceChat(s, { t: "tool-result", toolUseId: "t1", output: "a.txt", isError: false });
    expect(s.items.at(-1)).toMatchObject({ kind: "tool", status: "done", output: "a.txt" });
    s = reduceChat(s, { t: "tool-use", id: "t2", name: "Bash", input: { command: "bad" } });
    s = reduceChat(s, { t: "tool-result", toolUseId: "t2", output: "no", isError: true });
    expect(s.items.at(-1)).toMatchObject({ status: "error" });
  });

  it("ends a turn on its result, on an error and on a stop, closing anything still running", () => {
    const running = reduceChat(buildChat(events), {
      t: "tool-use",
      id: "t1",
      name: "Bash",
      input: {},
    });
    const result = reduceChat(running, { t: "result", ok: true, durationMs: 3200 });
    expect(result.working).toBe(false);
    expect(result.items.at(-1)).toMatchObject({ kind: "turn", ok: true, durationMs: 3200 });
    expect(result.items.find((i) => i.kind === "tool")).toMatchObject({ status: "done" });
    expect(result.items.find((i) => i.kind === "assistant")).toMatchObject({ streaming: false });
    expect(reduceChat(running, { t: "error", message: "boom" }).items.at(-1)).toEqual({
      kind: "error",
      message: "boom",
    });
    const stopped = reduceChat(running, { t: "stopped" });
    expect(stopped.working).toBe(false);
    expect(stopped.items.at(-1)).toEqual({ kind: "stopped" });
  });

  it("has helpers for the footer and the compact cards", () => {
    expect(formatDuration(3200)).toBe("3.2 s");
    expect(formatDuration(65_000)).toBe("1 min 5 s");
    expect(formatDuration(null)).toBe("");
    expect(toolSummary({ command: "git  status\n" })).toBe("git status");
    expect(toolSummary({ file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(emptyChat()).toEqual({ items: [], working: false });
  });
});

describe("Claude's stream as chat events", () => {
  it("turns partial messages, the finished message, tool calls, results and the result line into events", () => {
    const p = new ClaudeChatParser();
    const line = (o: unknown): ChatEvent[] => p.parse(JSON.stringify(o));
    expect(
      line({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } }),
    ).toEqual([{ t: "assistant-start", id: "m1" }]);
    expect(
      line({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
      }),
    ).toEqual([{ t: "text-delta", id: "m1", text: "Hi" }]);
    expect(
      line({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "hm" },
        },
      }),
    ).toEqual([{ t: "thinking-delta", id: "m1", text: "hm" }]);
    expect(
      line({
        type: "assistant",
        message: {
          id: "m1",
          content: [
            { type: "text", text: "Hi there" },
            { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "a" } },
          ],
        },
      }),
    ).toEqual([
      { t: "assistant", id: "m1", text: "Hi there", thinking: "" },
      { t: "tool-use", id: "tu1", name: "Read", input: { file_path: "a" } },
    ]);
    expect(
      line({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: [{ type: "text", text: "ok" }],
              is_error: false,
            },
          ],
        },
      }),
    ).toEqual([{ t: "tool-result", toolUseId: "tu1", output: "ok", isError: false }]);
    expect(line({ type: "result", is_error: false, duration_ms: 1200, result: "x" })).toEqual([
      { t: "result", ok: true, durationMs: 1200 },
    ]);
    expect(line({ type: "result", is_error: true, result: "bad" })[0]).toMatchObject({
      ok: false,
      error: "bad",
    });
    expect(p.parse("not json")).toEqual([]);
    expect(line({ type: "system", subtype: "init" })).toEqual([]);
  });

  it("writes a user message as the stream-json input shape, with an image block per pasted image", () => {
    expect(userMessage("hello", [])).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
      parent_tool_use_id: null,
    });
    const withImage = userMessage("look", [{ mediaType: "image/png", data: "AAAA" }]);
    expect(JSON.stringify(withImage)).toContain(
      '{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}',
    );
  });
});

describe("Codex's stream as chat events", () => {
  it("reads the thread id, messages, commands and the end of the turn", () => {
    const p = new CodexChatParser();
    const feed = (o: unknown): ChatEvent[] => p.parse(JSON.stringify(o));
    expect(feed({ type: "thread.started", thread_id: "T1" })).toEqual([]);
    expect(p.threadId).toBe("T1");
    expect(
      feed({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "done" } }),
    ).toEqual([{ t: "assistant", id: "i1", text: "done", thinking: "" }]);
    expect(
      feed({
        type: "item.completed",
        item: {
          id: "i2",
          type: "command_execution",
          command: "ls",
          aggregated_output: "a",
          exit_code: 1,
        },
      }),
    ).toEqual([
      { t: "tool-use", id: "i2", name: "Bash", input: { command: "ls" } },
      { t: "tool-result", toolUseId: "i2", output: "a", isError: true },
    ]);
    expect(feed({ type: "turn.completed" })[0]).toMatchObject({ t: "result", ok: true });
  });
});

/** The chat service with the fake CLIs, a relay and a broker, as the app wires them. */
function harness() {
  const db = openDb(":memory:");
  const bus = new Bus();
  const providers = new ProviderRegistry();
  const workspace = {
    version: 1,
    roles: {},
    projects: [],
    notifications: { urgent: [], mutedProjects: [] },
  } as unknown as Workspace;
  const notifier = new Notifier({
    db,
    bus,
    workspace: () => workspace,
    quietHours: () => undefined,
  });
  const dir = mkdtempSync(join(tmpdir(), "office-chat-"));
  const cwd = mkdtempSync(join(tmpdir(), "office-chat-cwd-"));
  const sessions = new SessionService({
    db,
    bus,
    providers,
    notifier,
    workspace: () => workspace,
    projectPath: () => cwd,
    logsDir: join(dir, "logs"),
    defaultMode: () => "chat",
  });
  const hook: { fn?: (runId: string, waiting: boolean) => void } = {};
  const broker = new PermissionBroker({ db, bus, notifier, onWaiting: (r, w) => hook.fn?.(r, w) });
  const chat = new ChatService({
    bus,
    providers,
    sessions,
    chatsDir: join(dir, "chats"),
    broker,
    writeMcpConfig: (id, d) => writePermissionMcpConfig(d, id, bridge),
  });
  hook.fn = (r, w) => chat.permissionWaiting(r, w);
  sessions.chat = {
    send: (id, text) => chat.send(id, text),
    configure: (id, extra) => chat.configure(id, extra),
    stop: (id) => chat.stop(id),
    running: (id) => chat.running(id),
    keep: (id) => chat.keep(id),
    forget: (id) => chat.forget(id),
    history: (id) => chat.history(id),
  };
  const relay = new RelayServer("tok", {
    onClaude: () => true,
    onCodex: () => true,
    onPermission: (runId, body, signal) => broker.request(runId, body, signal),
  });
  return { db, bus, sessions, chat, broker, relay, cwd, dir };
}

async function until(cond: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !cond()) await new Promise((r) => setTimeout(r, 40));
  if (!cond()) throw new Error("timed out");
}

const kinds = (h: ReturnType<typeof harness>, id: string): string[] =>
  h.chat.history(id).map((l) => l.event.t);

describe("a Claude chat with the fake CLI", () => {
  it("starts as a chat row with no terminal, streams an answer and ends the turn idle", async () => {
    const h = harness();
    const row = h.sessions.start({ providerId: "fake", projectId: "p", title: "Chat one" });
    expect(row).toMatchObject({ mode: "chat", status: "idle", running: false });
    expect(h.sessions.pty.isRunning(row.id)).toBe(false);

    h.chat.send(row.id, "hello there");
    await until(() => kinds(h, row.id).includes("result"));
    const state = buildChat(h.chat.history(row.id).map((l) => l.event));
    expect(state.items[0]).toMatchObject({ kind: "user", text: "hello there" });
    expect(state.items[1]).toMatchObject({
      kind: "assistant",
      text: "echo: hello there",
      streaming: false,
    });
    expect(state.items.at(-1)).toMatchObject({ kind: "turn", ok: true });
    // The answer streamed in as several pieces first.
    expect(h.chat.history(row.id).filter((l) => l.event.t === "text-delta").length).toBeGreaterThan(
      1,
    );
    await until(() => h.sessions.get(row.id).status === "idle");
    expect(h.sessions.get(row.id).running).toBe(true); // the program stays up between turns
    expect(() => h.chat.send(row.id, "x")).not.toThrow();
    await until(() => kinds(h, row.id).filter((k) => k === "result").length === 2);
    h.chat.stop(row.id);
  });

  it("draws tool cards, an edit, a todo list and thinking", async () => {
    const h = harness();
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    h.chat.send(row.id, "THINK READ src/a.ts EDIT TODO RUN git status");
    await until(() => kinds(h, row.id).includes("result"));
    const s = buildChat(h.chat.history(row.id).map((l) => l.event));
    const tools = s.items.filter((i) => i.kind === "tool");
    expect(tools.map((t) => (t.kind === "tool" ? t.name : ""))).toEqual([
      "Read",
      "Edit",
      "Bash",
      "TodoWrite",
    ]);
    expect(tools.every((t) => t.kind === "tool" && t.status === "done")).toBe(true);
    expect(tools[1]).toMatchObject({ input: { old_string: "one", new_string: "two" } });
    expect(tools[2]).toMatchObject({ output: "ran: git status" });
    expect(s.items.find((i) => i.kind === "assistant")).toMatchObject({
      thinking: "Let me think about it.",
    });
    h.chat.stop(row.id);
  });

  it("sends a pasted image as an image block", async () => {
    const h = harness();
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    h.chat.send(row.id, "look at this", [{ mediaType: "image/png", data: "AAAA" }]);
    await until(() => kinds(h, row.id).includes("result"));
    const user = h.chat.history(row.id)[0]?.event;
    expect(user).toMatchObject({ t: "user", images: 1 });
    expect(JSON.stringify(h.chat.history(row.id))).toContain("echo: look at this (1 image)");
    h.chat.stop(row.id);
  });

  it("asks through a permission card: deny returns the reason, allow lets the turn finish", async () => {
    const h = harness();
    await h.relay.start(0);
    const row = h.sessions.start({ providerId: "fake", projectId: "p", title: "Asks" });

    h.chat.send(row.id, "NEEDS_PERMISSION: rm -rf build");
    await until(() => h.broker.list().length === 1);
    expect(h.broker.list()[0]).toMatchObject({
      runId: row.id,
      subject: "Asks",
      summary: "rm -rf build",
    });
    expect(h.sessions.get(row.id).status).toBe("needs-you");
    h.broker.answer(h.broker.list()[0]!.id, false, "not here");
    await until(() => kinds(h, row.id).includes("result"));
    let text = JSON.stringify(h.chat.history(row.id));
    expect(text).toContain("The owner declined: not here");
    await until(() => h.sessions.get(row.id).status === "idle");

    h.chat.send(row.id, "NEEDS_PERMISSION: make release");
    await until(() => h.broker.list().length === 1);
    h.broker.answer(h.broker.list()[0]!.id, true);
    await until(() => kinds(h, row.id).filter((k) => k === "result").length === 2);
    text = JSON.stringify(h.chat.history(row.id));
    expect(text).toContain("after the owner allowed it");
    h.chat.stop(row.id);
    await h.relay.stop();
  });

  it("stops a running turn, records it, and the next message resumes the same conversation", async () => {
    const h = harness();
    const log = join(h.dir, "args.log");
    process.env["FAKE_ARGS_LOG"] = log;
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    h.chat.send(row.id, "SLOW please");
    await until(() => h.sessions.get(row.id).status === "working");
    expect(() => h.chat.send(row.id, "again")).toThrow(/still running/);
    h.chat.stop(row.id);
    expect(kinds(h, row.id).at(-1)).toBe("stopped");
    expect(h.sessions.get(row.id)).toMatchObject({ status: "idle", running: false });

    h.chat.send(row.id, "second message");
    await until(() => kinds(h, row.id).includes("result"));
    const runs = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { args: string[] });
    expect(runs[0]?.args).toContain("--session-id");
    expect(runs[0]?.args).toContain("--include-partial-messages");
    expect(runs[0]?.args).toContain("--permission-prompt-tool");
    expect(runs[1]?.args).toContain("--resume");
    expect(runs[1]?.args[runs[1].args.indexOf("--resume") + 1]).toBe(row.id);
    h.chat.stop(row.id);
  });

  it("starts a chat fresh when it was told to resume a conversation that was never saved", async () => {
    const h = harness();
    const log = join(h.dir, "args.log");
    process.env["FAKE_ARGS_LOG"] = log;
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    // As if the first program was ended before it saved anything: marked started, but no conversation exists.
    h.sessions.markStarted(row.id);
    h.chat.send(row.id, "first words");
    await until(() => kinds(h, row.id).includes("result"));
    const runs = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { args: string[] });
    // The program refused the resume; the same message ran again, started fresh, and shows once.
    expect(runs.at(-1)?.args).toContain("--session-id");
    expect(kinds(h, row.id).filter((k) => k === "user")).toHaveLength(1);
    expect(h.sessions.get(row.id).conversationStarted).toBe(true);
    h.chat.stop(row.id);
  });

  it("resumes a chat when the conversation it was told to start already exists", async () => {
    const h = harness();
    const log = join(h.dir, "args.log");
    process.env["FAKE_ARGS_LOG"] = log;
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    h.sessions.markStarted(row.id, false);
    // The fake CLI keeps conversations under the fake home; this one is already there.
    const store = join(process.env["OFFICE_HOME"] ?? "", ".fake-claude-sessions");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, row.id), "");
    h.chat.send(row.id, "hello again");
    await until(() => kinds(h, row.id).includes("result"));
    const runs = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { args: string[] });
    expect(runs.at(-1)?.args).toContain("--resume");
    h.chat.stop(row.id);
  });

  it("reopens a past chat from its stored events, after a restart", async () => {
    const h = harness();
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    h.chat.send(row.id, "remember this");
    await until(() => kinds(h, row.id).includes("result"));
    h.chat.stop(row.id);
    const file = join(h.dir, "chats", row.id, "chat.jsonl");
    expect(existsSync(file)).toBe(true);
    // A new service on the same folder reads the same conversation.
    const again = new ChatService({
      bus: h.bus,
      providers: new ProviderRegistry(),
      sessions: h.sessions,
      chatsDir: join(h.dir, "chats"),
      broker: h.broker,
      writeMcpConfig: () => "",
    });
    const state = buildChat(again.history(row.id).map((l) => l.event));
    expect(state.items[0]).toMatchObject({ text: "remember this" });
    expect(again.history(row.id).map((l) => l.seq)).toEqual(
      again.history(row.id).map((_, i) => i + 1),
    );
    writeFileSync(file, `${readFileSync(file, "utf8")}{"half`);
    expect(again.history(row.id).length).toBe(h.chat.history(row.id).length);
  });

  it("moves to a terminal and back on the same provider session", async () => {
    const h = harness();
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    h.chat.send(row.id, "before");
    await until(() => kinds(h, row.id).includes("result"));
    const terminal = h.chat.toTerminal(row.id);
    expect(terminal).toMatchObject({ mode: "terminal", providerSessionId: row.id });
    await until(() => h.sessions.get(row.id).running);
    expect(h.sessions.pty.isRunning(row.id)).toBe(true);
    const back = await h.chat.toChat(row.id);
    expect(back).toMatchObject({ mode: "chat", providerSessionId: row.id, status: "idle" });
    expect(h.sessions.pty.isRunning(row.id)).toBe(false);
    h.chat.send(row.id, "after");
    await until(() => kinds(h, row.id).filter((k) => k === "result").length === 2);
    h.chat.stop(row.id);
    h.sessions.shutdown();
  });

  it("passes the extra folders a chat was started with (Explore reads the brain) to the program", async () => {
    const h = harness();
    const log = join(h.dir, "dirs.log");
    process.env["FAKE_ARGS_LOG"] = log;
    const brain = mkdtempSync(join(tmpdir(), "office-brain-"));
    const row = h.sessions.start({ providerId: "fake", projectId: "p" }, { addDirs: [brain] });
    h.chat.send(row.id, "hi");
    await until(() => kinds(h, row.id).includes("result"));
    const args = (
      JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0] as string) as { args: string[] }
    ).args;
    expect(args[args.indexOf("--add-dir") + 1]).toBe(brain);
    h.chat.stop(row.id);
  });

  it("a session that began as a terminal carries on in the chat with --resume, never --session-id", async () => {
    const h = harness();
    const log = join(h.dir, "origin.log");
    const row = h.sessions.start({ providerId: "fake", projectId: "p", mode: "terminal" });
    await until(() => h.sessions.history(row.id).data.includes("ready"));
    expect(h.sessions.get(row.id).conversationStarted).toBe(true);
    await h.sessions.stop(row.id);
    process.env["FAKE_ARGS_LOG"] = log;
    const back = await h.chat.toChat(row.id);
    expect(back.mode).toBe("chat");
    h.chat.send(row.id, "carry on from the terminal");
    await until(() => kinds(h, row.id).includes("result"));
    expect(JSON.stringify(h.chat.history(row.id))).toContain("echo: carry on from the terminal");
    expect(JSON.stringify(h.chat.history(row.id))).not.toContain('"t":"error"');
    const args = (
      JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0] as string) as { args: string[] }
    ).args;
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    h.chat.stop(row.id);
    h.sessions.shutdown();
  });

  it("a chat with no message yet opens in a terminal as a new conversation, not a resume of one that does not exist", async () => {
    const h = harness();
    const row = h.sessions.start({ providerId: "fake", projectId: "p" });
    expect(h.sessions.get(row.id).conversationStarted).toBe(false);
    const terminal = h.chat.toTerminal(row.id);
    expect(terminal.mode).toBe("terminal");
    await until(() => h.sessions.history(row.id).data.includes("ready"));
    await new Promise((r) => setTimeout(r, 300));
    expect(h.sessions.get(row.id).running).toBe(true); // the fake exits at once on a bad --resume
    expect(h.sessions.get(row.id).conversationStarted).toBe(true);
    // And back to the chat, the first message resumes the conversation the terminal began.
    await h.chat.toChat(row.id);
    h.chat.send(row.id, "hello again");
    await until(() => kinds(h, row.id).includes("result"));
    expect(JSON.stringify(h.chat.history(row.id))).not.toContain('"t":"error"');
    h.chat.stop(row.id);
    h.sessions.shutdown();
  });

  it("opens as a terminal when asked, and old sessions stay terminals", () => {
    const h = harness();
    const asked = h.sessions.start({ providerId: "fake", projectId: "p", mode: "terminal" });
    expect(asked.mode).toBe("terminal");
    h.db
      .prepare(
        "INSERT INTO sessions (id, provider, cwd, status, interactive, created_at, updated_at) VALUES ('old', 'fake', '/x', 'exited', 1, 'a', 'b')",
      )
      .run();
    expect(h.sessions.get("old").mode).toBe("terminal");
    h.sessions.shutdown();
  });
});

describe("a Codex chat with the fake CLI", () => {
  it("runs two turns on one thread, resuming it with the sandbox passed through config", async () => {
    const h = harness();
    const log = join(h.dir, "codex.log");
    process.env["FAKE_ARGS_LOG"] = log;
    const row = h.sessions.start({ providerId: "codex", projectId: "p", title: "Codex chat" });
    expect(row).toMatchObject({ mode: "chat", providerSessionId: null });
    const state = await h.chat.state(row.id);
    expect(state).toMatchObject({ kind: "codex", sandbox: "workspace-write", permissionModes: [] });

    h.chat.send(row.id, "first question");
    await until(() => kinds(h, row.id).filter((k) => k === "result").length === 1);
    await until(() => h.sessions.get(row.id).providerSessionId !== null);
    const thread = h.sessions.get(row.id).providerSessionId as string;
    await until(() => !h.chat.running(row.id));

    h.chat.send(row.id, "second question");
    await until(() => kinds(h, row.id).filter((k) => k === "result").length === 2);
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { args: string[] });
    expect(calls[0]?.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(calls[0]?.args).toContain("-s");
    expect(calls[1]?.args.slice(0, 3)).toEqual(["exec", "resume", "--json"]);
    expect(calls[1]?.args).toContain(thread);
    expect(calls[1]?.args).toContain('sandbox_mode="workspace-write"');
    const text = JSON.stringify(h.chat.history(row.id));
    expect(text).toContain("FAKE CODEX: first question");
    expect(text).toContain("FAKE CODEX: second question");
  });
});

describe("Chat sessions: saved, incognito, named and archived", () => {
  const start = (h: ReturnType<typeof harness>, incognito: boolean, title = "New chat") =>
    h.sessions.start(
      { providerId: "fake", cwd: h.cwd, title, mode: "chat" },
      { roleLabel: "chat", restricted: true, incognito },
    );

  it("a saved chat is named by its first message and writes its log to the app's data", async () => {
    const h = harness();
    const row = start(h, false);
    h.chat.send(row.id, "   Which   sheep\nare best? ");
    await until(() => kinds(h, row.id).includes("result"));
    expect(h.sessions.get(row.id).title).toBe("Which sheep are best?");
    expect(existsSync(join(h.dir, "chats", row.id, "chat.jsonl"))).toBe(true);
    // A long first message is shortened, not used whole.
    const second = start(h, false);
    h.chat.send(second.id, "x".repeat(200));
    expect(h.sessions.get(second.id).title).toHaveLength(60);
  });

  it("an incognito chat keeps its words in memory only, is never listed, and is erased on discard", async () => {
    const h = harness();
    const row = start(h, true, "Incognito chat");
    h.chat.send(row.id, "a private question");
    await until(() => kinds(h, row.id).includes("result"));
    // Said, but written nowhere in the app's data, and not turned into a title.
    expect(kinds(h, row.id)).toContain("user");
    expect(existsSync(join(h.dir, "chats", row.id))).toBe(false);
    expect(h.sessions.get(row.id).title).toBe("Incognito chat");
    expect(h.sessions.list({ chats: true }).map((s) => s.id)).not.toContain(row.id);
    // Gone for good once discarded.
    h.chat.forget(row.id);
    h.sessions.discardIncognito(row.id);
    expect(h.sessions.find(row.id)).toBeUndefined();
    expect(h.chat.history(row.id)).toEqual([]);
  });

  it("an incognito chat left behind by a killed run is cleared at the next start", () => {
    const h = harness();
    const row = start(h, true, "Incognito chat");
    expect(h.sessions.takeLeftoverIncognito()).toEqual([h.cwd]);
    expect(h.sessions.find(row.id)).toBeUndefined();
  });

  it("keeping an incognito chat writes what was said to its log; saved chats archive when idle unless pinned", async () => {
    const h = harness();
    const row = start(h, true, "Incognito chat");
    h.chat.send(row.id, "keep this one");
    await until(() => kinds(h, row.id).includes("result"));
    h.chat.keep(row.id);
    h.sessions.keepIncognito(row.id);
    const saved = readFileSync(join(h.dir, "chats", row.id, "chat.jsonl"), "utf8");
    expect(saved).toContain("keep this one");
    expect(h.sessions.list({ chats: true }).map((s) => s.id)).toContain(row.id);
    // Chats are in Chat's list, not in the work sessions list.
    expect(h.sessions.list().map((s) => s.id)).not.toContain(row.id);

    // Idle for longer than the idle time: archived, unless pinned.
    const other = start(h, false);
    h.sessions.pin(other.id, true);
    h.db
      .prepare("UPDATE sessions SET updated_at = ?, status = 'idle' WHERE id IN (?, ?)")
      .run("2020-01-01T00:00:00Z", row.id, other.id);
    expect(h.sessions.archiveIdleChats(2)).toBe(1);
    expect(h.sessions.get(row.id).archivedAt).not.toBeNull();
    expect(h.sessions.get(other.id).archivedAt).toBeNull();
  });
});
