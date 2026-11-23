// A fake `claude` for the cloud routines tests. It answers `claude -p "<prompt>" --allowedTools RemoteTrigger ...`
// the way the real program does: a stream-json run in which each requested RemoteTrigger call is a tool_use block
// and a tool_result whose text starts "HTTP <status>" and then the raw JSON. All data is synthetic.
//
// FAKE_CLOUD_DATA  a JSON file: { scenario, replies: { <action>: body }, status: { <action>: number } }
// FAKE_CLOUD_LOG   a file every request seen is appended to, one JSON line each
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] ?? "";
const data = JSON.parse(readFileSync(process.env["FAKE_CLOUD_DATA"], "utf8"));
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

out({ type: "system", subtype: "init", session_id: "fake-session", model: "haiku" });
appendFileSync(process.env["FAKE_CLOUD_LOG"], `${JSON.stringify({ args })}\n`);

if (data.scenario === "signed-out") {
  out({ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Not logged in. Please run /login" }] } });
  out({ type: "result", is_error: true, result: "Not logged in. Please run /login" });
  process.exit(1);
}

const requests = [...prompt.matchAll(/\d+\. (\{.*?\}\}?)(?= \d+\. |$)/g)].map((match) => JSON.parse(match[1]));
if (data.scenario === "old") {
  out({ type: "assistant", message: { content: [{ type: "text", text: "I have no such tool." }] } });
  out({ type: "result", is_error: false, result: "done" });
  process.exit(0);
}

// The tool is deferred: the first result only loads it.
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "load", content: [{ type: "tool_reference", tool_name: "RemoteTrigger" }] }] } });
requests.forEach((input, index) => {
  appendFileSync(process.env["FAKE_CLOUD_LOG"], `${JSON.stringify({ request: input })}\n`);
  const id = `toolu_${index}`;
  out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "RemoteTrigger", input }] } });
  const key = input.action === "list_runs" ? `list_runs:${input.trigger_id}` : input.action === "get_run_log" ? `get_run_log:${input.session_id}` : input.action;
  const body = data.replies[key] ?? data.replies[input.action] ?? {};
  const status = data.status?.[input.action] ?? 200;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: `HTTP ${status}\n${text}` }] } });
});
// The model's own words: a decoy that looks like a reply and must never be read.
out({ type: "assistant", message: { content: [{ type: "text", text: "HTTP 200\n{\"data\":[{\"id\":\"trig_decoy\",\"name\":\"Decoy\"}]}" }] } });
out({ type: "result", is_error: false, result: "done" });
