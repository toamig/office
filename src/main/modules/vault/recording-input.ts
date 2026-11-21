import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { ChatLine } from "../../../shared/models";

export const Cursor = z.object({
  chat: z.number().int().nonnegative().default(0),
  terminal: z.object({ stamp: z.string(), offset: z.number().int().nonnegative() }).optional(),
});
export type Cursor = z.infer<typeof Cursor>;

const LIMIT = 24_000;

function readTail(path: string, previous: Cursor["terminal"]) {
  let handle: number | undefined;
  try {
    handle = openSync(path, "r");
    const stat = fstatSync(handle);
    const stamp = `${stat.birthtimeMs}:${stat.ino}`;
    const offset = stamp === previous?.stamp ? previous.offset : 0;
    const start = Math.max(offset <= stat.size ? offset : 0, stat.size - LIMIT);
    const buffer = Buffer.alloc(stat.size - start);
    const count = readSync(handle, buffer, 0, buffer.length, start);
    return { cursor: { stamp, offset: start + count }, text: buffer.subarray(0, count).toString("utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

export function readRecording(chats: string, terminals: string, id: string, cursor: Cursor) {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("Invalid session id.");
  const chatPath = join(chats, id, "chat.jsonl");
  const terminalPath = join(terminals, `${id}.log`);
  const chat = readChat(chatPath, cursor.chat);
  const current = readTail(terminalPath, cursor.terminal);
  const old = current && cursor.terminal?.stamp !== current.cursor.stamp
    ? readTail(`${terminalPath}.1`, cursor.terminal)
    : null;
  const terminal = stripVTControlCharacters(`${old?.text ?? ""}\n${current?.text ?? ""}`).trim();
  return {
    cursor: { chat: chat.offset, ...(current ? { terminal: current.cursor } : {}) },
    text: [chat.text, terminal ? `Terminal transcript\n${terminal.slice(-LIMIT / 2)}` : ""]
      .filter(Boolean).join("\n\n"),
  };
}

function readChat(path: string, offset: number): { offset: number; text: string } {
  let handle: number | undefined;
  try {
    handle = openSync(path, "r");
    const size = fstatSync(handle).size;
    const start = Math.max(offset <= size ? offset : 0, size - 6 * LIMIT);
    const buffer = Buffer.alloc(size - start);
    const count = readSync(handle, buffer, 0, buffer.length, start);
    const end = buffer.lastIndexOf(10, count - 1) + 1;
    const lines = buffer.subarray(0, end).toString("utf8").split("\n");
    const messages: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = ChatLine.safeParse(JSON.parse(line));
        if (parsed.success && (parsed.data.event.t === "user" || parsed.data.event.t === "assistant")) {
          const { event } = parsed.data;
          messages.push(`${event.t === "user" ? "Owner" : "Assistant"}: ${event.text}`);
        }
      } catch {
        // The byte cap can cut the first JSON line.
      }
    }
    return { offset: start + end, text: messages.join("\n\n").slice(-LIMIT / 2) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { offset, text: "" };
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}
