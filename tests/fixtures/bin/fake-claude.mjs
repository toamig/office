// A fake `claude` CLI for tests and `npm run dev`. It behaves like the real CLI for the parts
// Office drives: --version, auth status, mcp list, headless `-p` with stream-json output, and an
// interactive mode that runs the user's hooks the way Claude Code does.
//
// Headless behaviour is selected by the prompt text (see `respond`), so tests stay readable.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);
const home = process.env["OFFICE_HOME"] ?? "";

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

// ---------- simple commands ----------
if (args[0] === "--version") {
  console.log("2.1.999 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  const loggedIn = process.env["FAKE_LOGGED_IN"] !== "0";
  console.log(JSON.stringify({ loggedIn, authMethod: "fake" }, null, 2));
  process.exit(loggedIn ? 0 : 1);
}
if (args[0] === "mcp" && args[1] === "list") {
  console.log("Checking MCP server health...\n");
  console.log("notion: npx -y @notionhq/notion-mcp-server - ✔ Connected");
  console.log("other: https://example.invalid/mcp (HTTP) - ! Needs authentication");
  process.exit(0);
}

// ---------- hooks, as Claude Code runs them ----------
function runHooks(event, sessionId, extra = {}) {
  try {
    const settingsPath = join(home, ".claude", "settings.json");
    if (!existsSync(settingsPath)) return;
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const payload = JSON.stringify({
      session_id: sessionId,
      hook_event_name: event,
      cwd: process.cwd(),
      ...extra,
    });
    for (const group of settings.hooks?.[event] ?? []) {
      for (const hook of group.hooks ?? []) {
        if (hook.type === "command" && hook.command) {
          spawnSync(hook.command, { input: payload, shell: true, stdio: ["pipe", "ignore", "ignore"], timeout: 10000 });
        }
      }
    }
  } catch {
    /* hooks never break the agent */
  }
}

// ---------- headless ----------
const prompt = has("-p") ? args[args.indexOf("-p") + 1] : null;
const sessionId = flag("--session-id") ?? flag("--resume") ?? "00000000-0000-4000-8000-000000000001";

function writeFileAt(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Decides what a headless run does, from the prompt. Returns the final text. */
function respond(text) {
  const plan = /Write the plan to (.+?)\.?$/m.exec(text);
  if (plan) {
    writeFileAt(plan[1], "# Plan\n\n1. Do the thing.\n");
    return `Plan written to ${plan[1]}`;
  }
  if (/Implement the plan/.test(text)) {
    const name = `built-${Date.now()}.txt`;
    writeFileSync(join(process.cwd(), name), "built by the fake builder\n");
    execFileSync("git", ["add", "--", name], { stdio: "ignore" });
    execFileSync("git", ["commit", "-q", "-m", "Fake builder change"], { stdio: "ignore" });
    return `Built ${name}`;
  }
  const findings = /Write findings to (.+?)\.?$/m.exec(text);
  if (findings) {
    writeFileAt(findings[1], "No problems found.\n");
    return `Findings written to ${findings[1]}`;
  }
  if (/left undone or waiting/.test(text)) {
    return JSON.stringify({
      items: [
        { text: "Decide the art style", kind: "waiting" },
        { text: "Write the level two script", kind: "todo" },
      ],
    });
  }
  if (/Answer from this vault/.test(text)) {
    return "Alpha is a fixture game, and its notes say so.\n\nSources: Alpha/Overview.md, Alpha/OpenItems.md";
  }
  if (/morning brief/i.test(text)) return "Yesterday: the fake agent changed things.";
  if (/SUMMARY_OF_EXPLORATION/.test(text)) return "## Positioning and vision\n\nA fake exploration summary.";
  if (/FAIL_RUN/.test(text)) throw new Error("the fake agent was told to fail");
  return `FAKE: ${text.slice(0, 60)}`;
}

if (prompt !== null) {
  out({ type: "system", subtype: "init", session_id: sessionId, model: flag("--model") ?? "fake" });
  try {
    const delay = Number(process.env["FAKE_DELAY_MS"] ?? 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const final = respond(prompt);
    out({ type: "assistant", message: { content: [{ type: "text", text: final }] } });
    out({ type: "result", subtype: "success", is_error: false, result: final, session_id: sessionId });
    process.exit(0);
  } catch (err) {
    out({ type: "result", subtype: "error_during_execution", is_error: true, result: String(err.message), session_id: sessionId });
    process.exit(1);
  }
}

// ---------- interactive ----------
// Reads lines as prompts. "ask" makes it raise a Notification (needs you), "quit" ends the session,
// anything else is a turn: UserPromptSubmit, a short reply, Stop.
const sid = sessionId;
runHooks("SessionStart", sid);
process.stdout.write(`fake-claude ready (${sid})\r\n> `);
const rl = createInterface({ input: process.stdin });
let ending = false;
function end(code) {
  if (ending) return;
  ending = true;
  runHooks("SessionEnd", sid);
  process.exit(code);
}
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  if (text === "quit") return end(0);
  if (text === "crash") return end(3);
  runHooks("UserPromptSubmit", sid, { prompt: text });
  if (text.startsWith("ask")) {
    process.stdout.write("Do you want to proceed? (y/n)\r\n");
    runHooks("Notification", sid, { message: "Claude needs your permission to continue" });
    return;
  }
  process.stdout.write(`echo: ${text}\r\n`);
  runHooks("Stop", sid);
  process.stdout.write("> ");
});
rl.on("close", () => end(0));
