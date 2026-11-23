/*
 * The headless `claude -p` call that reaches Claude Code's cloud routines. Office asks the program to call its
 * RemoteTrigger tool and reads the raw reply from the stream's tool_result blocks. The model's own words are never
 * read. Only the five actions below can be asked for, and only `run` and `update` change anything.
 */

export type CloudAction = "list" | "list_runs" | "get_run_log" | "run" | "update";

export type CloudRequest =
  | { action: "list" }
  | { action: "list_runs"; triggerId: string }
  | { action: "get_run_log"; sessionId: string }
  | { action: "run"; triggerId: string }
  | { action: "update"; triggerId: string; enabled: boolean };

/** Every action Office may ask for. Nothing that creates or deletes is on it. */
export const CLOUD_ACTIONS: readonly CloudAction[] = ["list", "list_runs", "get_run_log", "run", "update"];

const TRIGGER_ID = /^trig_[A-Za-z0-9_-]{1,80}$/;
const SESSION_ID = /^(?:cse|session)_[A-Za-z0-9_-]{1,80}$/;

export const isTriggerId = (value: unknown): value is string => typeof value === "string" && TRIGGER_ID.test(value);
export const isSessionId = (value: unknown): value is string => typeof value === "string" && SESSION_ID.test(value);

/** The input one call gets. Ids are checked here, so nothing but a plain id ever reaches the prompt. */
export function requestInput(request: CloudRequest): Record<string, unknown> {
  switch (request.action) {
    case "list": return { action: "list" };
    case "list_runs":
      if (!isTriggerId(request.triggerId)) throw new Error("Not a routine id.");
      return { action: "list_runs", trigger_id: request.triggerId };
    case "get_run_log":
      if (!isSessionId(request.sessionId)) throw new Error("Not a run id.");
      return { action: "get_run_log", session_id: request.sessionId };
    case "run":
      if (!isTriggerId(request.triggerId)) throw new Error("Not a routine id.");
      return { action: "run", trigger_id: request.triggerId };
    case "update":
      if (!isTriggerId(request.triggerId)) throw new Error("Not a routine id.");
      if (typeof request.enabled !== "boolean") throw new Error("Only on or off can be changed.");
      return { action: "update", trigger_id: request.triggerId, body: { enabled: request.enabled } };
    default:
      throw new Error("That action is not allowed.");
  }
}

/** The arguments of one headless run that makes the given calls, in order. */
export function remoteTriggerArgs(requests: CloudRequest[], model: string): string[] {
  const lines = requests.map((request, index) => `${index + 1}. ${JSON.stringify(requestInput(request))}`);
  const prompt = [
    "Call the RemoteTrigger tool once for each numbered request below, in order, with exactly that input.",
    "Do not change the input, do not call any other tool, and do not explain the results. Finish with the word done.",
    ...lines,
  ].join(" ");
  return ["-p", prompt, "--allowedTools", "RemoteTrigger", "--model", model, "--no-session-persistence",
    "--output-format", "stream-json", "--verbose"];
}

export interface CloudReply {
  /** The action the call asked for, when the stream shows it. */
  action: string | null;
  input: Record<string, unknown> | null;
  status: number;
  /** The text after the status line. */
  body: string;
}

export interface CloudStream {
  replies: CloudReply[];
  /** A reason in words when the stream has no usable reply. */
  problem: string | null;
  /** What the program said, only for the reason shown under Details. */
  detail: string | null;
}

type Json = Record<string, unknown>;
const asJson = (line: string): Json | null => {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The text of a tool_result's content; a tool_reference (the tool being loaded) has none. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block && typeof block === "object" && (block as Json)["type"] === "text" ? str((block as Json)["text"]) : "")).join("");
}

const SIGN_IN = /not logged in|not authenticated|please run \/login|\/login|invalid api key|authentication|unauthori[sz]ed|oauth|sign in|log in/i;

/**
 * Reads the replies of the RemoteTrigger calls from the stream, and says in words why there are none: no sign-in, a
 * program too old to have the tool, or a status other than 200. The assistant's own text is only kept for Details.
 */
export function parseCloudStream(stdout: string, stderr = "", code = 0): CloudStream {
  const calls = new Map<string, Json>();
  const replies: CloudReply[] = [];
  let failure: string | null = null;
  let sawResult = false;
  const said: string[] = [];
  for (const line of stdout.split("\n")) {
    const event = asJson(line.trim());
    if (!event) continue;
    const message = (event["message"] ?? {}) as Json;
    const content = Array.isArray(message["content"]) ? (message["content"] as Json[]) : [];
    if (event["type"] === "assistant") {
      for (const block of content) {
        if (block["type"] === "tool_use" && block["name"] === "RemoteTrigger")
          calls.set(str(block["id"]), (block["input"] && typeof block["input"] === "object" ? block["input"] : {}) as Json);
        if (block["type"] === "text" && str(block["text"])) said.push(str(block["text"]));
      }
      if (event["error"]) failure = said.join(" ") || str(event["error"]);
    } else if (event["type"] === "user") {
      for (const block of content) {
        if (block["type"] !== "tool_result") continue;
        const text = resultText(block["content"]);
        const status = /^HTTP (\d{3})\b[^\n]*\n?/.exec(text);
        if (!status) continue; // the tool_reference that loads the tool, or text that is not a reply
        const input = calls.get(str(block["tool_use_id"])) ?? null;
        replies.push({ action: input ? str(input["action"]) || null : null, input, status: Number(status[1]), body: text.slice(status[0].length) });
      }
    } else if (event["type"] === "result") {
      sawResult = true;
      if (event["is_error"] === true) failure = str(event["result"]) || failure;
    } else if (event["type"] === "error") {
      failure = str(event["message"]) || failure;
    }
  }
  if (replies.length > 0) return { replies, problem: null, detail: null };
  const detail = [failure, stderr.trim()].filter(Boolean).join("\n").slice(0, 2000) || (said.join(" ").slice(0, 2000) || null);
  if (SIGN_IN.test(`${failure ?? ""}\n${stderr}`))
    return { replies, problem: "Sign in to Claude to see your cloud routines.", detail };
  if (code !== 0 && !sawResult)
    return { replies, problem: "Claude Code could not be started to read your cloud routines.", detail };
  return { replies, problem: "This version of Claude Code cannot read cloud routines. Update Claude Code.", detail };
}

/** The first reply that says HTTP 200 for the action, or the words for the status it gave instead. */
export function expectReply(stream: CloudStream, action: CloudAction): { body: string } | { problem: string; detail: string | null } {
  if (stream.problem) return { problem: stream.problem, detail: stream.detail };
  const found = stream.replies.find((reply) => reply.action === action) ?? (stream.replies.length === 1 ? stream.replies[0] : undefined);
  if (!found) return { problem: "Claude Code did not return the cloud routines.", detail: stream.detail };
  if (found.status === 401 || found.status === 403)
    return { problem: "Sign in to Claude to see your cloud routines.", detail: `HTTP ${found.status}\n${found.body}`.slice(0, 2000) };
  if (found.status !== 200)
    return { problem: `Claude answered with HTTP ${found.status}, so the cloud routines could not be read.`, detail: found.body.slice(0, 2000) };
  return { body: found.body };
}

const object = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export interface CloudRoutine {
  id: string;
  name: string;
  cron: string | null;
  runOnceAt: string | null;
  enabled: boolean;
  endedReason: string | null;
  nextRunAt: string | null;
  lastFiredAt: string | null;
  lastRun: {
    sessionId: string | null; status: string | null; failureReason: string | null; firedAt: string | null; finishedAt: string | null;
  } | null;
  model: string | null;
  prompt: string | null;
  repositories: string[];
  connectors: string[];
}

/** The routines in a `list` reply. A reply that is not the expected shape is an error, never an empty list. */
export function parseRoutines(body: string): CloudRoutine[] {
  const data = object(safeParse(body));
  if (!data || !Array.isArray(data["data"])) throw new Error("The routines came back in a shape Office does not know.");
  const routines: CloudRoutine[] = [];
  for (const entry of data["data"]) {
    const item = object(entry);
    const id = text(item?.["id"]);
    if (!item || !id || !isTriggerId(id)) continue;
    const last = object(item["last_run"]);
    const derived = object(item["derived_state"]);
    const context = object(object(object(item["job_config"])?.["ccr"])?.["session_context"]);
    const sources = list(context?.["sources"]).flatMap((source) => {
      const url = text(object(object(source)?.["git_repository"])?.["url"]);
      return url ? [url] : [];
    });
    routines.push({
      id, name: text(item["name"]) ?? "Untitled routine", cron: text(item["cron_expression"]), runOnceAt: text(item["run_once_at"]),
      enabled: item["enabled"] === true, endedReason: text(item["ended_reason"]), nextRunAt: text(item["next_run_at"]),
      lastFiredAt: text(item["last_fired_at"]),
      lastRun: last ? {
        sessionId: text(last["session_id"]), status: text(last["status"]), failureReason: text(last["failure_reason"]),
        firedAt: text(last["fired_at"]), finishedAt: text(last["finished_at"]),
      } : null,
      model: text(derived?.["model"]) ?? text(context?.["model"]),
      prompt: text(derived?.["prompt"]),
      repositories: sources,
      connectors: list(item["mcp_connections"]).flatMap((connection) => { const name = text(object(connection)?.["name"]); return name ? [name] : []; }),
    });
  }
  return routines;
}

export interface CloudRunInfo { id: string; title: string | null; url: string | null; createdAt: string | null }

/** The recent runs in a `list_runs` reply. */
export function parseRuns(body: string): CloudRunInfo[] {
  const data = object(safeParse(body));
  if (!data || !Array.isArray(data["data"])) throw new Error("The runs came back in a shape Office does not know.");
  return data["data"].flatMap((entry) => {
    const item = object(entry);
    const id = text(item?.["id"]);
    if (!item || !id) return [];
    const url = text(item["url"]);
    return [{ id, title: text(item["title"]), url: url && /^https:\/\//.test(url) ? url : null, createdAt: text(item["created_at"]) }];
  });
}

export const RESULT_LIMIT = 20_000;

function safeParse(body: string): unknown {
  try { return JSON.parse(body); } catch { return null; }
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n").trim() || null;
  const item = object(value);
  if (!item) return null;
  return textOf(item["text"] ?? item["result"] ?? item["content"] ?? item["message"]);
}

/** The kinds of events that hold a run's last answer, in order of preference. */
const FINAL = /result|final/i;
const SAID = /assistant|agent|message|text/i;

function fromEvents(events: unknown[]): string | null {
  const items = events.map(object).filter((item): item is Json => item !== null);
  // Newest first: the first result, then the first thing the assistant said.
  for (const wanted of [FINAL, SAID]) {
    for (const item of items) {
      const kind = `${str(item["type"])} ${str(item["role"])} ${str(item["kind"])}`;
      if (wanted.test(kind)) { const found = textOf(item); if (found) return found; }
    }
  }
  return null;
}

/**
 * The final result in a `get_run_log` reply, kept at most 20000 characters. The reply is a small JSON header and a
 * condensed log with the newest events first, so the shape is read loosely: a result event, else the last thing the
 * assistant said, else the first lines of the log.
 */
export function parseRunLog(body: string): string | null {
  const whole = safeParse(body);
  const data = object(whole);
  let found: string | null = null;
  if (data) {
    found = textOf(data["result"] ?? data["final_result"]);
    for (const key of ["events", "log", "entries", "messages", "data"]) {
      if (!found && Array.isArray(data[key])) found = fromEvents(data[key] as unknown[]);
    }
  } else if (Array.isArray(whole)) {
    found = fromEvents(whole);
  }
  if (!found && !data) {
    const lines = body.split("\n");
    // The header is the first line when it is a JSON object; the log follows, newest first.
    const rest = lines.length > 0 && asJson(lines[0]?.trim() ?? "") ? lines.slice(1) : lines;
    const events = rest.flatMap((line) => { const event = asJson(line.trim()); return event ? [event] : []; });
    found = fromEvents(events);
    if (!found) {
      for (const line of rest) {
        const match = /^\W*(?:result|final result|assistant)\b\W*:?\s*(.+)$/i.exec(line.trim());
        if (match?.[1]) { found = match[1]; break; }
      }
    }
    if (!found) found = rest.join("\n").trim() || null;
  }
  return found ? found.slice(0, RESULT_LIMIT) : null;
}
