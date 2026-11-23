import type { ToolTestResult } from "../../../shared/tool-config";
import { spawnStream } from "../../core/exec";

export interface ConnectionTarget {
  address?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

const PROTOCOL = "2025-06-18";
const CLIENT = { name: "Office", version: "1" };

/** Splits a typed command into the program and its arguments, keeping quoted parts together. */
export function splitCommand(text: string): string[] {
  return [...text.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

const failed = (error: string): ToolTestResult => ({ ok: false, tools: 0, server: null, error });
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

function summarise(initialize: unknown, tools: unknown[]): ToolTestResult {
  const info = asRecord(asRecord(initialize)["serverInfo"]);
  return { ok: true, tools: tools.length, server: typeof info["name"] === "string" ? info["name"] : null, error: null };
}

async function overStdio(target: ConnectionTarget, timeoutMs: number): Promise<ToolTestResult> {
  const [program, ...rest] = target.command ? [target.command, ...(target.args ?? [])] : [];
  if (!program) return failed("Enter the command that starts the server.");
  const parts = target.args ? [program, ...rest] : splitCommand(program);
  const stream = spawnStream(parts[0]!, parts.slice(1), { keepStdin: true, ...(target.env ? { env: target.env } : {}) });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  const reader = (async () => {
    for await (const line of stream.lines) {
      try {
        const message = asRecord(JSON.parse(line));
        const id = message["id"];
        if (typeof id === "number") pending.get(id)?.(message);
      } catch { /* a log line, not a message */ }
    }
  })();
  const request = (id: number, method: string, params: unknown): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      pending.set(id, resolve);
      stream.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  const exited = stream.exit.then((result) => failed(result.stderr.trim().split(/\r?\n/).pop() || "The server stopped before it answered."));
  const work = (async (): Promise<ToolTestResult> => {
    const init = await request(1, "initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT });
    if (init["error"]) return failed(String(asRecord(init["error"])["message"] ?? "The server refused to start."));
    stream.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const answer = await request(2 + page, "tools/list", cursor ? { cursor } : {});
      if (answer["error"]) return failed(String(asRecord(answer["error"])["message"] ?? "The server could not list its tools."));
      const result = asRecord(answer["result"]);
      if (Array.isArray(result["tools"])) tools.push(...result["tools"]);
      cursor = typeof result["nextCursor"] === "string" ? result["nextCursor"] : undefined;
      if (!cursor) break;
    }
    return summarise(asRecord(init["result"]), tools);
  })();
  const timeout = new Promise<ToolTestResult>((resolve) => setTimeout(() => resolve(failed("The server did not answer in time.")), timeoutMs).unref());
  try {
    return await Promise.race([work, exited, timeout]);
  } finally {
    stream.kill();
    void reader.catch(() => undefined);
  }
}

/** A streamable HTTP reply is JSON, or a server-sent event stream holding the JSON. */
async function readReply(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (data) { try { return asRecord(JSON.parse(data)); } catch { /* next event */ } }
    }
    return {};
  }
  try { return asRecord(JSON.parse(text)); } catch { return {}; }
}

async function overHttp(address: string, timeoutMs: number): Promise<ToolTestResult> {
  let url: URL;
  try { url = new URL(address); } catch { return failed("That is not a web address."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") return failed("Use an address that starts with https:// or http://.");
  const signal = AbortSignal.timeout(timeoutMs);
  let session: string | null = null;
  const post = async (body: unknown): Promise<Response> => fetch(url, {
    method: "POST", signal,
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL,
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify(body),
  });
  try {
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT } });
    if (init.status === 401 || init.status === 403) return failed("The server asked for a sign-in. Connect it from the agent program instead.");
    if (!init.ok) return failed(`The server answered ${init.status}.`);
    session = init.headers.get("mcp-session-id");
    const started = await readReply(init);
    if (started["error"]) return failed(String(asRecord(started["error"])["message"] ?? "The server refused to start."));
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).then((response) => response.text()).catch(() => undefined);
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const response = await post({ jsonrpc: "2.0", id: 2 + page, method: "tools/list", params: cursor ? { cursor } : {} });
      if (!response.ok) return failed(`The server answered ${response.status}.`);
      const answer = await readReply(response);
      if (answer["error"]) return failed(String(asRecord(answer["error"])["message"] ?? "The server could not list its tools."));
      const result = asRecord(answer["result"]);
      if (Array.isArray(result["tools"])) tools.push(...result["tools"]);
      cursor = typeof result["nextCursor"] === "string" ? result["nextCursor"] : undefined;
      if (!cursor) break;
    }
    return summarise(asRecord(started["result"]), tools);
  } catch (error) {
    return failed(signal.aborted ? "The server did not answer in time." : error instanceof Error ? error.message : String(error));
  }
}

/** Tries a connection the way an agent would: starts it, asks for its tools, and reports "Connected, N tools". */
export function testConnection(target: ConnectionTarget, timeoutMs = 20_000): Promise<ToolTestResult> {
  return target.address ? overHttp(target.address, timeoutMs) : overStdio(target, timeoutMs);
}
