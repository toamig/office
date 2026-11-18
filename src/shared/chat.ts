import type { ChatEvent } from "./models";

/** What the chat view draws, in order. */
export type ChatItem =
  | { kind: "user"; id: string; text: string; images: number }
  | { kind: "assistant"; id: string; text: string; thinking: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: "running" | "done" | "error";
      output: string;
    }
  | { kind: "error"; message: string }
  | { kind: "turn"; ok: boolean; durationMs: number | null; error: string | undefined }
  | { kind: "stopped" };

export interface ChatState {
  items: ChatItem[];
  /** True from the owner's message until the turn's result (or a stop or an error). */
  working: boolean;
}

export const emptyChat = (): ChatState => ({ items: [], working: false });

const indexOfAssistant = (items: ChatItem[], id: string): number =>
  items.findIndex((i) => i.kind === "assistant" && i.id === id);

/** Closes anything still streaming or running, when a turn ends. */
function settle(items: ChatItem[], toolStatus: "done" | "error"): ChatItem[] {
  return items.map((item) => {
    if (item.kind === "assistant" && item.streaming) return { ...item, streaming: false };
    if (item.kind === "tool" && item.status === "running") return { ...item, status: toolStatus };
    return item;
  });
}

/**
 * Builds the conversation from its events, one at a time. Pure, so the live view, a reopened chat and the
 * tests all agree. A streamed message is replaced by its final text when that arrives, and a repeated
 * tool call or message id never makes a second item.
 */
export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  const items = state.items;
  switch (event.t) {
    case "user":
      return {
        items: [...items, { kind: "user", id: event.id, text: event.text, images: event.images }],
        working: true,
      };
    case "turn-start":
      return { ...state, working: true };
    case "assistant-start": {
      if (indexOfAssistant(items, event.id) >= 0) return state;
      return {
        ...state,
        items: [
          ...items,
          { kind: "assistant", id: event.id, text: "", thinking: "", streaming: true },
        ],
      };
    }
    case "text-delta":
    case "thinking-delta": {
      const at = indexOfAssistant(items, event.id);
      const next = [...items];
      const base =
        at >= 0
          ? (items[at] as Extract<ChatItem, { kind: "assistant" }>)
          : { kind: "assistant" as const, id: event.id, text: "", thinking: "", streaming: true };
      const grown =
        event.t === "text-delta"
          ? { ...base, text: base.text + event.text }
          : { ...base, thinking: base.thinking + event.text };
      if (at >= 0) next[at] = grown;
      else next.push(grown);
      return { ...state, items: next };
    }
    case "assistant": {
      const at = indexOfAssistant(items, event.id);
      const base =
        at >= 0
          ? (items[at] as Extract<ChatItem, { kind: "assistant" }>)
          : { kind: "assistant" as const, id: event.id, text: "", thinking: "", streaming: false };
      const done = {
        ...base,
        text: event.text !== "" ? event.text : base.text,
        thinking: event.thinking !== "" ? event.thinking : base.thinking,
        streaming: false,
      };
      const next = [...items];
      if (at >= 0) next[at] = done;
      else next.push(done);
      return { ...state, items: next };
    }
    case "tool-use": {
      if (items.some((i) => i.kind === "tool" && i.id === event.id)) return state;
      return {
        ...state,
        items: [
          ...items,
          {
            kind: "tool",
            id: event.id,
            name: event.name,
            input: event.input,
            status: "running",
            output: "",
          },
        ],
      };
    }
    case "tool-result":
      return {
        ...state,
        items: items.map((i) =>
          i.kind === "tool" && i.id === event.toolUseId
            ? { ...i, status: event.isError ? "error" : "done", output: event.output }
            : i,
        ),
      };
    case "result":
      return {
        items: [
          ...settle(items, event.ok ? "done" : "error"),
          { kind: "turn", ok: event.ok, durationMs: event.durationMs, error: event.error },
        ],
        working: false,
      };
    case "error":
      return {
        items: [...settle(items, "error"), { kind: "error", message: event.message }],
        working: false,
      };
    case "stopped":
      return { items: [...settle(items, "done"), { kind: "stopped" }], working: false };
  }
}

/** Replays stored events into a conversation. */
export function buildChat(events: ChatEvent[]): ChatState {
  return events.reduce(reduceChat, emptyChat());
}

/** How long a turn took, for the footer: "3.2 s", "1 min 5 s". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** The one-line version of a tool call, for the compact cards (a file read, a command). */
export function toolSummary(input: Record<string, unknown>): string {
  const text = (key: string): string =>
    typeof input[key] === "string" ? (input[key] as string) : "";
  const first =
    text("command") || text("file_path") || text("path") || text("pattern") || text("url");
  if (first) return first.replace(/\s+/g, " ").trim();
  const keys = Object.keys(input);
  return keys.length === 0 ? "" : JSON.stringify(input).slice(0, 140);
}
