import type { StreamHandle } from "../../core/exec";
import type { AgentEvent, AgentRun, AgentRunResult } from "./types";

type Json = Record<string, unknown>;

const asJson = (line: string): Json | null => {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" ? (value as Json) : null;
  } catch {
    return null;
  }
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function short(value: unknown, n = 120): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > n ? `${text.slice(0, n - 1)}...` : text;
}

/** One line of `claude -p --output-format stream-json --verbose` output as normalised events. */
export function parseClaudeLine(line: string): AgentEvent[] {
  const obj = asJson(line);
  if (!obj) return [];
  const type = str(obj["type"]);
  if (type === "system" && str(obj["subtype"]) === "init" && obj["session_id"]) {
    return [{ kind: "session", providerSessionId: str(obj["session_id"]) }];
  }
  if (type === "assistant") {
    const content = ((obj["message"] as Json | undefined)?.["content"] ?? []) as Json[];
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (block["type"] === "text" && str(block["text"])) {
        events.push({ kind: "text", text: str(block["text"]) });
      } else if (block["type"] === "tool_use") {
        events.push({ kind: "tool", name: str(block["name"]), summary: short(block["input"]) });
      }
    }
    return events;
  }
  if (type === "result") {
    const events: AgentEvent[] = [];
    if (obj["session_id"])
      events.push({ kind: "session", providerSessionId: str(obj["session_id"]) });
    // A tool the run asked for while nobody could answer is listed on the final result.
    const denials = Array.isArray(obj["permission_denials"])
      ? (obj["permission_denials"] as Json[])
      : [];
    for (const d of denials) {
      events.push({ kind: "denied", name: str(d["tool_name"]), summary: short(d["tool_input"]) });
    }
    events.push({ kind: "result", text: str(obj["result"]), ok: obj["is_error"] !== true });
    return events;
  }
  if (type === "error") return [{ kind: "error", message: str(obj["message"]) || short(obj) }];
  return [];
}

/** One line of `codex exec --json` output. Understands the item-based and the older msg-based shapes. */
export function parseCodexLine(line: string): AgentEvent[] {
  const obj = asJson(line);
  if (!obj) return [];
  const type = str(obj["type"]);
  if (type === "thread.started" && obj["thread_id"]) {
    return [{ kind: "session", providerSessionId: str(obj["thread_id"]) }];
  }
  if (type === "item.completed" || type === "item.updated") {
    const item = (obj["item"] ?? {}) as Json;
    const itemType = str(item["type"]);
    if (itemType === "agent_message" && type === "item.completed") {
      return [{ kind: "text", text: str(item["text"]) }];
    }
    if (
      type === "item.completed" &&
      ["command_execution", "file_change", "mcp_tool_call", "web_search"].includes(itemType)
    ) {
      return [
        {
          kind: "tool",
          name: itemType,
          summary: short(item["command"] ?? item["changes"] ?? item["tool"] ?? item["query"]),
        },
      ];
    }
    return [];
  }
  if (type === "turn.failed") {
    return [
      {
        kind: "error",
        message: str((obj["error"] as Json | undefined)?.["message"]) || "Codex turn failed",
      },
    ];
  }
  if (type === "error") return [{ kind: "error", message: str(obj["message"]) || short(obj) }];
  const msg = obj["msg"] as Json | undefined;
  if (msg) {
    if (msg["type"] === "agent_message") return [{ kind: "text", text: str(msg["message"]) }];
    if (msg["type"] === "error") return [{ kind: "error", message: str(msg["message"]) }];
  }
  return [];
}

/**
 * Wraps a process stream as an AgentRun. Events are parsed as they arrive whether or not anyone
 * iterates them; `done` resolves when the process exits.
 */
export function startAgentRun(
  stream: StreamHandle,
  parse: (line: string) => AgentEvent[],
  finalText?: () => string | null,
): AgentRun {
  const queue: AgentEvent[] = [];
  let wake = null as (() => void) | null;
  let finished = false;
  let sessionId: string | undefined;
  let resultText = "";
  let lastText = "";
  let error: string | undefined;
  let sawResult = false;
  let resultOk = true;
  let cancelled = false;
  const denied: string[] = [];

  const done = (async (): Promise<AgentRunResult> => {
    for await (const line of stream.lines) {
      for (const event of parse(line)) {
        if (event.kind === "session") sessionId = event.providerSessionId;
        else if (event.kind === "text") lastText = event.text;
        else if (event.kind === "result") {
          sawResult = true;
          resultText = event.text;
          resultOk = event.ok;
        } else if (event.kind === "error") error = event.message;
        else if (event.kind === "denied") denied.push(`${event.name}: ${event.summary}`);
        queue.push(event);
        wake?.();
      }
    }
    const exit = await stream.exit;
    const fromFile = finalText?.() ?? null;
    const text = resultText || fromFile || lastText;
    const ok = !cancelled && exit.code === 0 && resultOk && !error;
    if (cancelled) error = "cancelled";
    else if (!ok && !error) error = (sawResult && !resultOk ? resultText : "") ||
      exit.stderr.trim().split("\n").pop() || `exit code ${exit.code}`;
    if (!sawResult) queue.push({ kind: "result", text, ok });
    finished = true;
    wake?.();
    return {
      ok,
      resultText: text,
      ...(sessionId ? { providerSessionId: sessionId } : {}),
      ...(error ? { error } : {}),
      ...(denied.length > 0 ? { denied } : {}),
    };
  })();

  async function* events(): AsyncGenerator<AgentEvent> {
    for (;;) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (finished) return;
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
  }

  return {
    events: events(),
    done,
    cancel: () => {
      cancelled = true;
      stream.kill();
    },
  };
}
