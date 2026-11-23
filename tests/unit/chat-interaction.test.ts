/* eslint-disable @typescript-eslint/no-explicit-any -- the lines of a fake program are untyped JSON */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { spawnStream } from "../../src/main/core/exec";
import { ChatService, type ChatServiceDeps } from "../../src/main/modules/chat/service";
import { ClaudeCodeProvider } from "../../src/main/modules/providers/claude-code";
import { PermissionBroker } from "../../src/main/modules/runs/permissions";
import { applyAutonomy, type AutonomyLevel } from "../../src/shared/autonomy";
import { replayChat } from "../../src/shared/chat";
import type { Role } from "../../src/shared/types";

vi.mock("../../src/main/core/exec", async (original) => ({
  ...(await original<typeof import("../../src/main/core/exec")>()),
  spawnStream: vi.fn(),
}));

const folders: string[] = [];
const questions = [
  { question: "Which colour?", header: "Colour", multiSelect: false, options: [{ label: "Red" }, { label: "Blue" }] },
  { question: "Which sizes?", header: "Size", multiSelect: true, options: [{ label: "S" }, { label: "L" }] },
];

afterEach(() => {
  vi.resetAllMocks();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A chat on the real Claude provider whose program is a fake: lines pushed in are what the CLI prints. */
function fixture(level: AutonomyLevel, restricted: boolean) {
  const folder = mkdtempSync(join(tmpdir(), "office-chat-interaction-"));
  folders.push(folder);
  const id = "11111111-2222-4333-8444-555555555555";
  if (restricted) {
    mkdirSync(join(folder, "chats", id), { recursive: true });
    writeFileSync(join(folder, "chats", id, "config.json"), JSON.stringify({ restricted: true }));
  }
  const row = { id, mode: "chat", cwd: folder, provider: "claude-code", title: "Chat", conversationStarted: false };
  const role = applyAutonomy({ provider: "claude-code", instructions: "", readOnly: false, allowedCommands: [] } as Role, level);
  const broker = new PermissionBroker({
    db: { prepare: () => ({ get: () => undefined }) } as never,
    bus: new Bus(), notifier: { notify: vi.fn() } as never,
  });
  const deps = {
    bus: new Bus(), chatsDir: join(folder, "chats"), broker,
    providers: { get: () => new ClaudeCodeProvider({ bin: "office-fixture-claude" }) },
    sessions: {
      find: () => row, get: () => row, markStarted: () => { row.conversationStarted = true; }, setStatus: vi.fn(),
      brainForSession: () => undefined, officeMcpForSession: () => undefined, roleForAgent: () => role,
    },
    writeMcpConfig: () => join(folder, "mcp.json"),
  } as unknown as ChatServiceDeps;
  const lines = new Readable({ objectMode: true, read() {} });
  const handle = { lines, exit: new Promise<{ code: number; stderr: string }>(() => undefined), write: vi.fn(), kill: vi.fn() };
  vi.mocked(spawnStream).mockReturnValue(handle);
  const chat = new ChatService(deps);
  chat.send(id, "ask me something");
  const spawned = () => vi.mocked(spawnStream).mock.calls[0]![1];
  const written = () => handle.write.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, any>);
  const ask = async (tool: string, input: Record<string, unknown>) => {
    lines.push(JSON.stringify({
      type: "control_request", request_id: "cb-1",
      request: { subtype: "hook_callback", callback_id: "office-chat-interaction", tool_use_id: "toolu_1", input: { tool_name: tool, tool_input: input } },
    }));
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    return broker.list()[0]!;
  };
  const askOverPrompt = async (tool: string, input: Record<string, unknown>) => {
    lines.push(JSON.stringify({ type: "control_request", request_id: "cb-1", request: { subtype: "can_use_tool", tool_name: tool, input, tool_use_id: "toolu_1" } }));
  };
  const reply = () => written().find((line) => line["type"] === "control_response" && line["response"]?.["request_id"] === "cb-1");
  return { id, chat, broker, spawned, written, ask, askOverPrompt, reply };
}

const levels: AutonomyLevel[] = ["ask-first", "act-on-risk", "full-auto"];

describe.each([false, true])("a question or plan in a chat (restricted: %s)", (restricted) => {
  it.each(levels)("is registered with the program at start in %s", (level) => {
    const { spawned, written } = fixture(level, restricted);
    const init = written().find((line) => line["request"]?.["subtype"] === "initialize");
    expect(init?.["request"]["hooks"]["PreToolUse"]).toEqual([
      expect.objectContaining({ matcher: "^(AskUserQuestion|ExitPlanMode)$", hookCallbackIds: ["office-chat-interaction"] }),
    ]);
    // Any tool list the chat passes must keep both tools; an unlisted tool list means the program's own set.
    const args = spawned();
    const tools = args.indexOf("--tools") >= 0 ? args[args.indexOf("--tools") + 1]!.split(",") : ["AskUserQuestion", "ExitPlanMode"];
    expect(tools).toEqual(expect.arrayContaining(["AskUserQuestion", "ExitPlanMode"]));
  });

  it.each(levels)("sends the chosen answers back to the program exactly as chosen in %s", async (level) => {
    const { id, chat, broker, ask, reply } = fixture(level, restricted);
    const request = await ask("AskUserQuestion", { questions });
    expect(request).toMatchObject({ runId: id, toolName: "AskUserQuestion", interaction: { kind: "questions" } });
    expect(replayChat(chat.history(id)).items.some((item) => item.kind === "interaction")).toBe(true);
    broker.answerInteraction(request.id, { kind: "questions", answers: [{ choices: ["Blue"] }, { choices: ["S", "L"], other: " XL " }] });
    await vi.waitFor(() => expect(reply()).toBeDefined());
    expect(reply()).toEqual({
      type: "control_response",
      response: {
        subtype: "success", request_id: "cb-1",
        response: { hookSpecificOutput: {
          hookEventName: "PreToolUse", permissionDecision: "allow",
          updatedInput: { questions, answers: { "Which colour?": "Blue", "Which sizes?": "S, L, XL" } },
        } },
      },
    });
    expect(broker.list()).toHaveLength(0);
  });

  it.each(levels)("refuses an answer that is not one of the options in %s", async (level) => {
    const { broker, ask, reply } = fixture(level, restricted);
    const request = await ask("AskUserQuestion", { questions });
    expect(() => broker.answerInteraction(request.id, { kind: "questions", answers: [{ choices: ["Green"] }, { choices: ["S"] }] })).toThrow();
    expect(() => broker.answerInteraction(request.id, { kind: "questions", answers: [{ choices: ["Red", "Blue"] }, { choices: ["S"] }] })).toThrow();
    expect(reply()).toBeUndefined();
    expect(broker.list()).toHaveLength(1);
  });

  it.each(levels)("sends approval of a plan back unchanged, and a refusal with its reason, in %s", async (level) => {
    const approved = fixture(level, restricted);
    const plan = await approved.ask("ExitPlanMode", { plan: "1. Do it" });
    expect(plan.interaction).toEqual({ kind: "plan", plan: "1. Do it" });
    approved.broker.answerInteraction(plan.id, { kind: "plan", approve: true });
    await vi.waitFor(() => expect(approved.reply()).toBeDefined());
    expect(approved.reply()?.["response"]["response"]["hookSpecificOutput"]).toEqual({
      hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { plan: "1. Do it" },
    });

    vi.mocked(spawnStream).mockReset();
    const refused = fixture(level, restricted);
    const second = await refused.ask("ExitPlanMode", { plan: "1. Do it" });
    refused.broker.answerInteraction(second.id, { kind: "plan", approve: false, reason: " Add tests first " });
    await vi.waitFor(() => expect(refused.reply()).toBeDefined());
    expect(refused.reply()?.["response"]["response"]["hookSpecificOutput"]).toEqual({
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Add tests first",
    });
  });

  it.each(levels)("denies the tool and drops the card when the chat is stopped in %s", async (level) => {
    const { id, chat, broker, ask, reply } = fixture(level, restricted);
    await ask("AskUserQuestion", { questions });
    chat.stop(id);
    await vi.waitFor(() => expect(broker.list()).toHaveLength(0));
    expect(reply()).toBeUndefined();
  });

  it.each(levels)("answers a question asked over the permission prompt channel the same way in %s", async (level) => {
    const { broker, askOverPrompt, reply } = fixture(level, restricted);
    await askOverPrompt("AskUserQuestion", { questions });
    await vi.waitFor(() => expect(broker.list()).toHaveLength(1));
    broker.answerInteraction(broker.list()[0]!.id, { kind: "questions", answers: [{ choices: ["Red"] }, { choices: ["L"] }] });
    await vi.waitFor(() => expect(reply()).toBeDefined());
    expect(reply()?.["response"]).toEqual({
      subtype: "success", request_id: "cb-1",
      response: { behavior: "allow", updatedInput: { questions, answers: { "Which colour?": "Red", "Which sizes?": "L" } } },
    });
  });

  it.each(levels)("refuses any other tool asked over the permission prompt channel in %s", async (level) => {
    const { broker, askOverPrompt, reply } = fixture(level, restricted);
    await askOverPrompt("Bash", { command: "rm -rf /" });
    await vi.waitFor(() => expect(reply()).toBeDefined());
    expect(broker.list()).toHaveLength(0);
    expect(reply()?.["response"]["response"]).toMatchObject({ behavior: "deny" });
  });

  it("answers a tool that is not a question or a plan with a refusal, without asking the owner", async () => {
    const { broker, reply, ask } = fixture("full-auto", restricted);
    await expect(ask("Bash", { command: "rm -rf /" })).rejects.toThrow();
    await vi.waitFor(() => expect(reply()).toBeDefined());
    expect(broker.list()).toHaveLength(0);
    expect(reply()?.["response"]["response"]["hookSpecificOutput"]).toMatchObject({ permissionDecision: "deny" });
  });
});
