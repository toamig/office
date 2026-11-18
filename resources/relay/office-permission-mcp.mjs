// office-permission-mcp: a tiny MCP server over stdio that Claude Code starts for a headless run
// (--mcp-config). It serves one tool, office_permission, and forwards each call to the running Office app,
// which asks the owner and answers allow or deny. Plain Node, no dependencies.
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

/** Asks Office. No timeout of its own: the owner may answer much later. */
function ask(args) {
  const info = relayInfo();
  if (!info || !runId) return Promise.resolve(deny("Office is not running, so nobody can approve this."));
  return new Promise((resolve) => {
    const body = JSON.stringify({
      tool_name: args.tool_name,
      input: args.input ?? {},
      tool_use_id: args.tool_use_id,
    });
    const req = http.request(
      {
        host: "127.0.0.1",
        port: info.port,
        path: `/permission/${encodeURIComponent(runId)}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${info.token}`,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          try {
            const answer = JSON.parse(text);
            if (answer && answer.behavior === "allow") resolve({ behavior: "allow", updatedInput: answer.updatedInput ?? args.input ?? {} });
            else resolve(deny(typeof answer?.message === "string" ? answer.message : "The owner declined this request."));
          } catch {
            resolve(deny("Office sent an answer that could not be read."));
          }
        });
      },
    );
    req.on("error", () => resolve(deny("Office could not be reached, so nobody can approve this.")));
    req.end(body);
  });
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
      },
    });
  }
  if (msg.id === undefined) return; // notifications need no answer
  if (msg.method === "ping") return send({ id: msg.id, result: {} });
  if (msg.method === "tools/list") return send({ id: msg.id, result: { tools: [TOOL] } });
  if (msg.method === "tools/call") {
    if (msg.params?.name !== TOOL.name) {
      return send({ id: msg.id, error: { code: -32602, message: `Unknown tool ${msg.params?.name}` } });
    }
    const decision = await ask(msg.params.arguments ?? {});
    return send({ id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } });
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
