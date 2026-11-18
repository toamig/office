// A fake `codex` CLI for tests. Rejects a config with service_tier = "default" like CLI 0.117.0 does,
// supports `exec --json -o <file>`, and runs the configured `notify` command after an interactive turn.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { parse as parseToml } from "smol-toml";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const home = process.env["OFFICE_HOME"] ?? "";
const config = join(home, ".codex", "config.toml");

function configProblem() {
  if (!home || !existsSync(config)) return null;
  return /service_tier\s*=\s*"default"/.test(readFileSync(config, "utf8"))
    ? `Error loading configuration: ${config}:4:16: unknown variant \`default\`, expected \`fast\` or \`flex\``
    : null;
}

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

if (args[0] === "--version") {
  console.log("codex-cli 0.117.0");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  const problem = configProblem();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  console.log("Logged in using ChatGPT");
  process.exit(0);
}

const threadId = "019fakefake-0000-4000-8000-000000000042";

if (args[0] === "exec") {
  const prompt = args[args.length - 1];
  if (process.env["FAKE_ARGS_LOG"]) {
    writeFileSync(process.env["FAKE_ARGS_LOG"], `${JSON.stringify({ tool: "codex", args })}
`, { flag: "a" });
  }
  const outFile = flag("-o");
  out({ type: "thread.started", thread_id: threadId });
  out({ type: "turn.started" });
  let text = `FAKE CODEX: ${prompt.slice(0, 60)}`;
  const findings = /Write findings to (.+?)\.?$/m.exec(prompt);
  if (findings) {
    mkdirSync(dirname(findings[1]), { recursive: true });
    writeFileSync(findings[1], "Codex review: no problems found.\n");
    text = `Findings written to ${findings[1]}`;
  }
  if (/FAIL_RUN/.test(prompt)) {
    out({ type: "turn.failed", error: { message: "the fake codex was told to fail" } });
    process.exit(1);
  }
  out({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } });
  out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${text}\n`);
  }
  process.exit(0);
}

// Interactive: each line is a turn; afterwards the configured notify command runs with the event JSON.
function notify() {
  try {
    const cfg = parseToml(readFileSync(config, "utf8"));
    if (!Array.isArray(cfg.notify) || cfg.notify.length === 0) return;
    const payload = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": threadId,
      cwd: process.cwd(),
      "last-assistant-message": "done",
    });
    const [cmd, ...rest] = cfg.notify;
    spawnSync(cmd, [...rest, payload], { stdio: "ignore", timeout: 10000 });
  } catch {
    /* notify problems never break the agent */
  }
}

process.stdout.write(`fake-codex ready (${threadId})\r\n> `);
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  if (text === "quit") process.exit(0);
  process.stdout.write(`echo: ${text}\r\n`);
  notify();
  process.stdout.write("> ");
});
rl.on("close", () => process.exit(0));
