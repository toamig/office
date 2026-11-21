import type { ChatEvent } from "../../../shared/models";

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
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

/** A tool result's content: a string, or blocks of text. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" ? str((b as Json)["text"]) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Turns the lines of `claude -p --output-format stream-json --include-partial-messages` into chat events:
 * partial events stream the text in, the finished assistant message replaces it, tool calls and their
 * results become cards, and the result line ends the turn.
 */
export class ClaudeChatParser {
  private messageId = "";
  private readonly subagents = new Set<string>();

  parse(line: string): ChatEvent[] {
    const message = asJson(line);
    if (!message) return [];
    const type = str(message["type"]);
    const parent = str(message["parent_tool_use_id"]);
    if (parent) return this.subagentMessage(parent, type, message);
    if (type === "stream_event") return this.partial(obj(message["event"]));
    if (type === "assistant") return this.assistant(obj(message["message"]));
    if (type === "user") return this.toolResults(obj(message["message"]));
    if (type === "system") {
      const id = str(message["tool_use_id"]);
      const subtype = str(message["subtype"]);
      if (id && subtype.startsWith("task_")) {
        const summary = str(message["summary"]) || str(message["description"]);
        const status = str(message["status"]);
        return [{
          t: "subagent", id,
          ...(subtype === "task_notification" ? { verdict: summary } : { progress: summary }),
          status: status === "failed" || status === "stopped" ? "error" : subtype === "task_notification" ? "done" : "working",
        }];
      }
    }
    if (type === "result") {
      const failed = message["is_error"] === true;
      return [
        {
          t: "result",
          ok: !failed,
          durationMs: typeof message["duration_ms"] === "number" ? message["duration_ms"] : null,
          ...(failed ? { error: str(message["result"]) || "The turn failed" } : {}),
        },
      ];
    }
    if (type === "error") return [{ t: "error", message: str(message["message"]) || line }];
    return [];
  }

  private subagentMessage(id: string, type: string, message: Json): ChatEvent[] {
    this.subagents.add(id);
    if (type !== "assistant") return [];
    const blocks = obj(message["message"])["content"];
    if (!Array.isArray(blocks)) return [];
    const text = blocks.map(obj).map((block) => str(block["text"]) || str(block["name"])).filter(Boolean).join("\n");
    return text ? [{ t: "subagent", id, status: "working", progress: text.slice(0, 600) }] : [];
  }

  private partial(event: Json): ChatEvent[] {
    const kind = str(event["type"]);
    if (kind === "message_start") {
      this.messageId = str(obj(event["message"])["id"]) || `m${Date.now()}`;
      return [{ t: "assistant-start", id: this.messageId }];
    }
    if (kind === "content_block_delta" && this.messageId) {
      const delta = obj(event["delta"]);
      if (delta["type"] === "text_delta" && str(delta["text"])) {
        return [{ t: "text-delta", id: this.messageId, text: str(delta["text"]) }];
      }
      if (delta["type"] === "thinking_delta" && str(delta["thinking"])) {
        return [{ t: "thinking-delta", id: this.messageId, text: str(delta["thinking"]) }];
      }
    }
    return [];
  }

  private assistant(message: Json): ChatEvent[] {
    const id = str(message["id"]) || this.messageId || `m${Date.now()}`;
    const blocks = Array.isArray(message["content"]) ? (message["content"] as Json[]) : [];
    const texts: string[] = [];
    const thoughts: string[] = [];
    const tools: ChatEvent[] = [];
    for (const block of blocks) {
      if (block["type"] === "text" && str(block["text"])) texts.push(str(block["text"]));
      else if (block["type"] === "thinking" && str(block["thinking"]))
        thoughts.push(str(block["thinking"]));
      else if (block["type"] === "tool_use") {
        const name = str(block["name"]);
        const toolId = str(block["id"]);
        const input = obj(block["input"]);
        if (name === "Agent" || name === "Task") {
          this.subagents.add(toolId);
          tools.push({
            t: "subagent", id: toolId, status: "working",
            task: str(input["description"]) || str(input["prompt"]).slice(0, 240) || "Subagent",
          });
          continue;
        }
        tools.push({
          t: "tool-use",
          id: toolId,
          name,
          input,
        });
      }
    }
    const events: ChatEvent[] = [];
    if (texts.length > 0 || thoughts.length > 0) {
      events.push({
        t: "assistant",
        id,
        text: texts.join("\n\n"),
        thinking: thoughts.join("\n\n"),
      });
    }
    return [...events, ...tools];
  }

  private toolResults(message: Json): ChatEvent[] {
    const content = message["content"];
    if (!Array.isArray(content)) return [];
    const events: ChatEvent[] = [];
    for (const block of content as Json[]) {
      if (block["type"] !== "tool_result") continue;
      const id = str(block["tool_use_id"]);
      if (this.subagents.has(id)) {
        events.push({
          t: "subagent", id, status: block["is_error"] === true ? "error" : "done",
          verdict: resultText(block["content"]),
        });
        continue;
      }
      events.push({
        t: "tool-result",
        toolUseId: id,
        output: resultText(block["content"]),
        isError: block["is_error"] === true,
      });
    }
    return events;
  }
}

/** The lines of `codex exec --json` as chat events. A turn is one process, so its end is the process's. */
export class CodexChatParser {
  /** The thread id, once Codex reports it. */
  threadId: string | undefined;
  private failed: string | undefined;
  private started = Date.now();

  parse(line: string): ChatEvent[] {
    const event = asJson(line);
    if (!event) return [];
    const type = str(event["type"]);
    if (type === "thread.started") {
      this.threadId = str(event["thread_id"]) || this.threadId;
      return [];
    }
    if (type === "turn.failed" || type === "error") {
      this.failed =
        str(obj(event["error"])["message"]) || str(event["message"]) || "The turn failed";
      return [{ t: "error", message: this.failed }];
    }
    if (type === "turn.completed") {
      return [{ t: "result", ok: !this.failed, durationMs: Date.now() - this.started }];
    }
    const item = obj(event["item"]);
    const id = str(item["id"]) || `i${Date.now()}`;
    const kind = str(item["type"]);
    if (kind === "collab_tool_call") {
      const receivers = Array.isArray(item["receiver_thread_ids"]) ? item["receiver_thread_ids"].map(str).filter(Boolean) : [];
      return receivers.map((thread): ChatEvent => {
        const state = obj(obj(item["agents_states"])[thread]);
        const status = str(state["status"]);
        const text = str(state["message"]);
        return {
          t: "subagent", id: thread,
          ...(str(item["prompt"]) ? { task: str(item["prompt"]).slice(0, 240) } : {}),
          ...(text ? { verdict: text } : {}),
          status: status === "completed" ? "done" : ["failed", "errored", "shutdown"].includes(status) ? "error" : "working",
        };
      });
    }
    if (type !== "item.completed") return [];
    if (kind === "agent_message")
      return [{ t: "assistant", id, text: str(item["text"]), thinking: "" }];
    if (kind === "reasoning")
      return [{ t: "assistant", id, text: "", thinking: str(item["text"]) }];
    if (kind === "command_execution") {
      const output = str(item["aggregated_output"]);
      const code = typeof item["exit_code"] === "number" ? item["exit_code"] : 0;
      return [
        { t: "tool-use", id, name: "Bash", input: { command: str(item["command"]) } },
        { t: "tool-result", toolUseId: id, output, isError: code !== 0 },
      ];
    }
    if (kind === "file_change") {
      const changes = Array.isArray(item["changes"]) ? (item["changes"] as Json[]) : [];
      const files = changes.map((c) => str(c["path"])).filter(Boolean);
      return [
        { t: "tool-use", id, name: "Edit", input: { file_path: files.join(", "), changes } },
        { t: "tool-result", toolUseId: id, output: files.join("\n"), isError: false },
      ];
    }
    if (kind === "mcp_tool_call" || kind === "web_search") {
      return [
        { t: "tool-use", id, name: kind, input: obj(item) },
        { t: "tool-result", toolUseId: id, output: "", isError: false },
      ];
    }
    return [];
  }
}
