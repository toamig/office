import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { replayChat } from "../../src/shared/chat";
import { Bus } from "../../src/main/core/bus";
import { spawnStream } from "../../src/main/core/exec";
import { ChatService, userMessage, type ChatServiceDeps } from "../../src/main/modules/chat/service";

vi.mock("../../src/main/core/exec", async (original) => ({
  ...(await original<typeof import("../../src/main/core/exec")>()),
  spawnStream: vi.fn(),
}));

const id = "test-chat";
const folders: string[] = [];

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "office-chat-queue-"));
  folders.push(folder);
  const chatCommand = vi.fn(() => ({ cmd: "isolated-cli", args: [] }));
  const row = { id, mode: "chat", cwd: folder, provider: "claude", title: "Test chat", conversationStarted: false };
  const deps = {
    bus: new Bus(), chatsDir: join(folder, "chats"),
    providers: { get: () => ({ chatKind: "claude", chatCommand }) },
    sessions: {
      find: () => row, markStarted: () => { row.conversationStarted = true; }, setStatus: vi.fn(),
      brainForSession: () => undefined, officeMcpForSession: () => undefined,
      roleForAgent: () => ({ autonomy: "full-auto" }),
    },
    broker: { cancelRun: vi.fn() },
  } as unknown as ChatServiceDeps;
  return { open: () => new ChatService(deps), chatCommand };
}

function stream() {
  const lines = new Readable({ objectMode: true, read() {} });
  let resolveExit!: (result: { code: number; stderr: string }) => void;
  const exit = new Promise<{ code: number; stderr: string }>((resolve) => { resolveExit = resolve; });
  const end = () => { lines.push(null); resolveExit({ code: 0, stderr: "" }); };
  const handle = { lines, exit, write: vi.fn(), kill: vi.fn(end) };
  vi.mocked(spawnStream).mockReturnValueOnce(handle);
  return {
    ...handle, end,
    result: (ok: boolean) => lines.push(JSON.stringify({ type: "result", is_error: !ok, ...(ok ? {} : { result: "fixture failure" }) })),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("keeps a failed turn's queue across restart and claims each entry once in order", async () => {
  const { open } = fixture();
  const firstProcess = stream();
  const chat = open();
  const read = (service: ChatService) => replayChat(service.history(id));
  const image = { mediaType: "image/png", data: "aGVsbG8=" };
  chat.submit(id, "first", []);
  chat.submit(id, "second", [image]);
  chat.submit(id, "third", []);
  const [second, third] = read(chat).queue;
  chat.editQueued(id, second!.id, "second edited");
  firstProcess.result(false);
  await vi.waitFor(() => expect(read(chat).working).toBe(false));
  expect(firstProcess.write).toHaveBeenCalledTimes(1);
  firstProcess.end();

  const nextProcess = stream();
  const reopened = open();
  expect(read(reopened).queue.map((entry) => entry.text)).toEqual(["second edited", "third"]);
  await reopened.sendQueued(id, second!.id);
  expect(nextProcess.write).toHaveBeenNthCalledWith(1, JSON.stringify(userMessage("second edited", [image])));
  nextProcess.result(true);
  await vi.waitFor(() => expect(nextProcess.write).toHaveBeenCalledTimes(2));
  expect(nextProcess.write).toHaveBeenNthCalledWith(2, JSON.stringify(userMessage("third", [])));
  nextProcess.end();
  const restarted = open();
  const replay = replayChat(restarted.visibleHistory(id));
  expect(replay.queue).toHaveLength(0);
  expect(replay.working).toBe(false);
  expect(replay.items.flatMap((item) => item.kind === "user" ? [item.id] : []).slice(1)).toEqual([second!.id, third!.id]);
  await expect(restarted.sendQueued(id, second!.id)).rejects.toThrow("no longer queued");
});

it("kills an unresponsive Claude program after five seconds and resumes the session", async () => {
  vi.useFakeTimers();
  const { open, chatCommand } = fixture();
  const firstProcess = stream();
  const chat = open();
  chat.submit(id, "first", []);
  const stopped = chat.interrupt(id);
  expect(JSON.parse(String(firstProcess.write.mock.calls[1]?.[0]))).toMatchObject({
    type: "control_request", request_id: expect.any(String), request: { subtype: "interrupt" },
  });
  await vi.advanceTimersByTimeAsync(4999);
  expect(firstProcess.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await stopped;
  expect(firstProcess.kill).toHaveBeenCalledOnce();
  expect(chat.history(id).at(-1)?.event.t).toBe("stopped");
  expect(chat.running(id)).toBe(false);
  const nextProcess = stream();
  chat.submit(id, "continue", []);
  expect(chatCommand).toHaveBeenLastCalledWith(expect.objectContaining({ resume: true }));
  chat.stop(id);
  expect(nextProcess.kill).toHaveBeenCalledOnce();
});
