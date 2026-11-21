// office-permission-mcp: a tiny MCP server over stdio that Claude Code starts for a headless run
// It forwards permission requests and conversation tools to the running Office app.
//
//   node office-permission-mcp.mjs <run id>
//
// The call stays open for as long as the owner takes (hours are fine: Claude Code's per-server `timeout`
// is raised in the run's MCP config). When Office is not reachable the answer is deny, never allow.
import { readFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const runId = process.argv[2] ?? "";
const conversationToken = process.env.OFFICE_CONVERSATION_TOKEN;
const permissionEnabled = !conversationToken || process.env.OFFICE_HOST_PERMISSION === "1";

function dataDir() {
  if (process.env.OFFICE_DATA) return process.env.OFFICE_DATA;
  const home = process.env.OFFICE_HOME || homedir();
  if (process.platform === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Office");
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Office");
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "Office");
}

function relayInfo() {
  try {
    const info = JSON.parse(readFileSync(join(dataDir(), "relay.json"), "utf8"));
    return info && info.port && info.token ? info : null;
  } catch {
    return null;
  }
}

const deny = (message) => ({ behavior: "deny", message });

/** The owner may take a while to answer, so the server keeps the connection open. */
function relay(route, payload, token) {
  const info = relayInfo();
  if (!info || !runId) return Promise.resolve({ error: "Office is not running." });
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: info.port,
        path: `/${route}/${encodeURIComponent(runId)}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${token ?? info.token}`,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) resolve({ error: "Office refused the connection." });
            else resolve(JSON.parse(text));
          } catch {
            resolve({ error: "Office sent an answer that could not be read." });
          }
        });
      },
    );
    req.on("error", () => resolve({ error: "Office could not be reached." }));
    req.end(body);
  });
}

async function ask(args) {
  const answer = await relay("permission", args);
  if (answer?.behavior === "allow")
    return { behavior: "allow", updatedInput: answer.updatedInput ?? args.input ?? {} };
  return deny(answer?.message ?? answer?.error ?? "The owner declined this request.");
}

const TOOL = {
  name: "office_permission",
  description: "Asks the owner, through the Office app, whether a tool may run. Answers allow or deny.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string", description: "The tool that wants to run" },
      input: { type: "object", description: "The input the tool was called with" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
};

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function handle(msg) {
  if (msg.method === "initialize") {
    return send({
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "office", version: "1" },
        ...(conversationToken ? { instructions: "Use Office tools for actions the owner asks for. Office handles approvals." } : {}),
      },
    });
  }
  if (msg.id === undefined) return; // notifications need no answer
  if (msg.method === "ping") return send({ id: msg.id, result: {} });
  if (msg.method === "tools/list") {
    const result = conversationToken ? await relay("office-tools", { kind: "list" }, conversationToken) : {};
    const tools = [...(permissionEnabled ? [TOOL] : []), ...(Array.isArray(result?.tools) ? result.tools : [])];
    return send({ id: msg.id, result: { tools } });
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    if (name === TOOL.name && permissionEnabled) {
      const decision = await ask(args);
      return send({ id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } });
    }
    if (!conversationToken || typeof name !== "string") {
      return send({ id: msg.id, error: { code: -32602, message: `Unknown tool ${msg.params?.name}` } });
    }
    const result = await relay("office-tools", { kind: "call", name, arguments: args }, conversationToken);
    return send({ id: msg.id, result: {
      ...(result?.error ? { isError: true } : {}),
      content: [{ type: "text", text: JSON.stringify(result) }],
    } });
  }
  send({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  void handle(msg);
});
lines.on("close", () => process.exit(0));
