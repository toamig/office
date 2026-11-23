import type { AgentInteraction, ChatEvent, ChatLine, InteractionAnswer, OfficeBrief, PlanStep, QueuedMessage } from "./models";

/** What the chat view draws, in order. */
export type ChatItem =
  | { kind: "user"; id: string; text: string; images: number; brief?: OfficeBrief }
  | { kind: "assistant"; id: string; text: string; thinking: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: "running" | "done" | "error";
      output: string;
      startedAt?: number;
    }
  | { kind: "plan"; id: string }
  | { kind: "interaction"; id: string; requestId: string; interaction: AgentInteraction; pending: boolean; answer?: InteractionAnswer }
  | { kind: "error"; message: string }
  | { kind: "subagent"; id: string; task: string; progress: string; verdict: string; status: "working" | "done" | "error" }
  | { kind: "turn"; ok: boolean; durationMs: number | null; error: string | undefined }
  | { kind: "stopped"; detail?: string };

export interface ChatState {
  items: ChatItem[];
  /** True from the owner's message until the turn's result (or a stop or an error). */
  working: boolean;
  activity: TurnActivity;
  queue: QueuedMessage[];
  commands: string[];
  snapshots: string[];
}

export const REWIND_LIMIT = 50;

interface RunningTool { id: string; label: string }

export interface TurnActivity {
  startedAt?: number;
  durationMs?: number;
  plan: PlanStep[];
  tools: RunningTool[];
}

export const emptyActivity = (): TurnActivity => ({ plan: [], tools: [] });
export const emptyChat = (): ChatState => ({ items: [], working: false, activity: emptyActivity(), queue: [], commands: [], snapshots: [] });

export function trackQueue(queue: QueuedMessage[], event: ChatEvent): QueuedMessage[] {
  if (event.t === "user" || event.t === "queue-remove") return queue.filter((message) => message.id !== event.id);
  if (event.t !== "queued") return queue;
  const { id, text, images } = event;
  const message = { id, text, images };
  return queue.some((entry) => entry.id === id)
    ? queue.map((entry) => entry.id === id ? message : entry) : [...queue, message];
}

export function planSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const step = entry as Record<string, unknown>;
    const text = step["content"] ?? step["step"] ?? step["text"];
    const status = step["completed"] === true ? "completed" : step["status"];
    return typeof text === "string" && text.trim()
      ? [{ text, status: status === "completed" || status === "in_progress" ? status : "pending" }]
      : [];
  });
}

export function planEvent(event: ChatEvent): ChatEvent {
  return event.t === "tool-use" && event.name === "TodoWrite"
    ? { t: "plan", id: event.id, steps: planSteps(event.input["todos"]) }
    : event;
}

export function toolGroup(name: string): "read" | "search" | "command" | undefined {
  if (["Read", "NotebookRead"].includes(name)) return "read";
  if (["Grep", "Glob", "LS", "WebSearch", "web_search"].includes(name)) return "search";
  if (["Bash", "PowerShell"].includes(name)) return "command";
  return undefined;
}

export function runningLabel(tool: { name: string; input: Record<string, unknown> }): string {
  const summary = toolSummary(tool.input).slice(0, 140);
  const group = toolGroup(tool.name);
  const verb = group === "read" ? "Reading" : group === "search" ? "Searching" : "Running";
  return `${verb} ${summary || tool.name}`;
}

export function trackActivity(state: TurnActivity, event: ChatEvent, at?: number): TurnActivity {
  switch (event.t) {
    case "user":
      return { ...emptyActivity(), startedAt: at };
    case "turn-start":
      return state.startedAt === undefined ? { ...state, startedAt: at } : state;
    case "plan":
      return { ...state, plan: event.steps };
    case "tool-use":
      return state.tools.some((tool) => tool.id === event.id) ? state : {
        ...state, tools: [...state.tools, { id: event.id, label: runningLabel(event) }],
      };
    case "tool-result":
      return { ...state, tools: state.tools.filter((tool) => tool.id !== event.toolUseId) };
    case "result":
    case "error":
    case "stopped":
      return {
        tools: [], plan: state.plan.every((step) => step.status === "completed") ? [] : state.plan,
        durationMs: state.startedAt !== undefined && at !== undefined
          ? Math.max(0, at - state.startedAt)
          : event.t === "result" ? event.durationMs ?? state.durationMs : state.durationMs,
      };
    default:
      return state;
  }
}

export function activityLabel(activity: TurnActivity): string {
  const label = activity.tools.at(-1)?.label ?? "Working";
  const step = activity.plan.findIndex((entry) => entry.status === "in_progress");
  if (!activity.plan.length) return label;
  if (step !== -1) return `${label}, step ${step + 1} of ${activity.plan.length}`;
  const done = activity.plan.filter((entry) => entry.status === "completed").length;
  return `${label}, ${done} of ${activity.plan.length} steps done`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

const indexOfAssistant = (items: ChatItem[], id: string): number =>
  items.findIndex((i) => i.kind === "assistant" && i.id === id);

/** Closes anything still streaming or running, when a turn ends. */
function settle(items: ChatItem[], toolStatus: "done" | "error"): ChatItem[] {
  return items.map((item) => {
    if (item.kind === "assistant" && item.streaming) return { ...item, streaming: false };
    if (item.kind === "interaction" && item.pending) return { ...item, pending: false };
    if (item.kind === "tool" && item.status === "running") return { ...item, status: toolStatus };
    if (item.kind === "subagent" && item.status === "working" && toolStatus === "error")
      return { ...item, status: "error" };
    return item;
  });
}

function failedTurn(items: ChatItem[], message: string): ChatItem[] {
  const last = items.at(-1);
  const text = message.trim();
  if (last?.kind === "error") {
    if (!text || last.message === text || last.message.length >= text.length)
      return items;
    return [...items.slice(0, -1), { kind: "error", message: text }];
  }
  const assistant = last?.kind === "assistant" ? last.text.trim() : "";
  const repeats = assistant.length >= 12 && text.length >= 12 &&
    (text.includes(assistant) || assistant.includes(text));
  return [...settle(repeats ? items.slice(0, -1) : items, "error"), { kind: "error", message: text }];
}

/**
 * Builds the conversation from its events, one at a time. Pure, so the live view, a reopened chat and the
 * tests all agree. A streamed message is replaced by its final text when that arrives, and a repeated
 * tool call or message id never makes a second item.
 */
export function reduceChat(previous: ChatState, raw: ChatEvent, at?: number): ChatState {
  const event = planEvent(raw);
  const activity = trackActivity(previous.activity, event, at);
  const queue = trackQueue(previous.queue, event);
  const state = activity === previous.activity && queue === previous.queue ? previous : { ...previous, activity, queue };
  const items = state.items;
  switch (event.t) {
    case "commands":
      return { ...state, commands: event.names };
    case "interaction": {
      const next: ChatItem = { kind: "interaction", id: event.id, requestId: event.requestId, interaction: event.interaction, pending: true };
      const previous = items.findIndex((item) => (item.kind === "tool" || item.kind === "interaction") && item.id === event.id);
      if (previous === -1) return { ...state, items: [...items, next] };
      return { ...state, items: items.map((item, index) => index === previous ? next : item) };
    }
    case "interaction-result":
      return { ...state, items: items.map((item) => item.kind === "interaction" && item.id === event.id
        ? { ...item, pending: false, answer: event.answer } : item) };
    case "cleared":
      return { ...emptyChat(), queue: state.queue, commands: state.commands };
    case "snapshot":
      return { ...state, snapshots: [...state.snapshots, event.id] };
    case "rewound":
    case "rewind-notified":
      return state;
    case "queued":
    case "queue-remove":
      return state;
    case "user": {
      const recent = new Set(items.filter((item) => item.kind === "user").slice(1 - REWIND_LIMIT).map((item) => item.id));
      return {
        ...state,
        snapshots: state.snapshots.filter((id) => recent.has(id)),
        items: [...items, { kind: "user", id: event.id, text: event.text, images: event.images, brief: event.brief }],
        working: true,
      };
    }
    case "turn-start":
      return { ...state, working: true };
    case "plan":
      return items.some((item) => item.kind === "plan" && item.id === event.id) ? state :
        { ...state, items: [...items, { kind: "plan", id: event.id }] };
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
      if (items.some((i) => (i.kind === "tool" || i.kind === "interaction") && i.id === event.id)) return state;
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
            startedAt: at,
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
    case "subagent": {
      const previous = items.find(
        (item): item is Extract<ChatItem, { kind: "subagent" }> =>
          item.kind === "subagent" && item.id === event.id,
      );
      const item: ChatItem = {
        kind: "subagent", id: event.id, task: event.task || previous?.task || "Subagent",
        progress: event.progress || previous?.progress || "",
        verdict: event.verdict || previous?.verdict || "",
        status: previous?.status === "done" && event.status === "working" ? "done" : event.status,
      };
      return {
        ...state,
        items: previous ? items.map((entry) => entry === previous ? item : entry) : [...items, item],
      };
    }
    case "result":
      if (!event.ok) return { ...state, items: failedTurn(items, event.error ?? ""), working: false };
      if (!state.working && items.at(-1)?.kind === "error") return state;
      return {
        ...state,
        items: [
          ...settle(items, event.ok ? "done" : "error"),
          { kind: "turn", ok: event.ok, durationMs: event.durationMs, error: event.error },
        ],
        working: false,
      };
    case "error":
      return { ...state, items: failedTurn(items, event.message), working: false };
    case "stopped":
      return { ...state, items: [...settle(items, "done"), { kind: "stopped", detail: event.detail }], working: false };
  }
}

/** Replays stored events into a conversation. */
export function buildChat(events: ChatEvent[]): ChatState {
  return events.reduce((state, event) => reduceChat(state, event), emptyChat());
}

export function replayChat(lines: ChatLine[]): ChatState {
  return lines.reduce((state, line) => reduceChat(state, line.event, Date.parse(line.at)), emptyChat());
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
