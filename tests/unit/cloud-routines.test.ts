import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeCloudSchedule, utcCronToLocal } from "../../src/shared/cloud";
import { run, clearToolCache } from "../../src/main/core/exec";
import { CloudRoutines, repoKey } from "../../src/main/modules/cloud/routines";
import {
  CLOUD_ACTIONS, expectReply, parseCloudStream, parseRoutines, parseRunLog, parseRuns, remoteTriggerArgs, requestInput,
} from "../../src/main/modules/cloud/remote-trigger";
import { tmp } from "../fixtures/repos/make";

const fake = resolve(__dirname, "../fixtures/bin/fake-claude-cloud.mjs");

// Synthetic routines in the shape the CLI returns; nothing here is a real routine, prompt, repository or id.
const routineA = {
  id: "trig_alpha1", name: "Alpha daily", cron_expression: "30 7 * * *", run_once_at: null, enabled: true, ended_reason: null,
  next_run_at: "2030-01-02T07:30:00Z", last_fired_at: "2030-01-01T07:30:00Z",
  last_run: { session_id: "cse_run_a1", status: "ROUTINE_RUN_STATUS_SUCCEEDED", failure_reason: null, fired_at: "2030-01-01T07:30:00Z", finished_at: "2030-01-01T07:33:10Z" },
  derived_state: { model: "claude-test-model", prompt: "Summarise the synthetic data." },
  job_config: { ccr: { session_context: { allowed_tools: ["Read"], model: "claude-test-model", sources: [{ git_repository: { url: "https://github.com/example-org/demo-repo.git" } }] } } },
  mcp_connections: [{ name: "Example Connector" }],
};
const routineB = {
  id: "trig_beta2", name: "Beta weekly", cron_expression: "0 9 * * 1", run_once_at: null, enabled: false, ended_reason: null,
  next_run_at: null, last_fired_at: "2030-01-01T09:00:00Z",
  last_run: { session_id: "cse_run_b1", status: "ROUTINE_RUN_STATUS_FAILED", failure_reason: "Synthetic failure", fired_at: "2030-01-01T09:00:00Z", finished_at: "2030-01-01T09:01:00Z" },
  derived_state: { model: "claude-test-model", prompt: "Weekly synthetic job." }, mcp_connections: [],
};
const routineC = {
  id: "trig_gamma3", name: "Gamma reminder", cron_expression: "", run_once_at: "2030-01-01T10:00:00Z", enabled: false, ended_reason: "run_once_fired",
  next_run_at: null, last_fired_at: "2030-01-01T10:00:00Z", last_run: null, derived_state: { model: null, prompt: "Remind." }, mcp_connections: [],
};
const listBody = { data: [routineA, routineB, routineC], has_more: false };

let dir: string;
let log: string;
const saved = { ...process.env };

function scenario(value: Record<string, unknown>): void {
  writeFileSync(join(dir, "data.json"), JSON.stringify(value));
}
const seen = (): Array<Record<string, unknown>> => readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
const requests = (): Array<Record<string, unknown>> => seen().flatMap((entry) => (entry["request"] ? [entry["request"] as Record<string, unknown>] : []));

beforeEach(() => {
  dir = tmp("office-cloud-");
  mkdirSync(dir, { recursive: true });
  log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  clearToolCache();
  process.env["OFFICE_BIN_CLAUDE"] = fake;
  process.env["FAKE_CLOUD_DATA"] = join(dir, "data.json");
  process.env["FAKE_CLOUD_LOG"] = log;
});
afterEach(() => {
  process.env = { ...saved };
  clearToolCache();
  rmSync(dir, { recursive: true, force: true });
});

/** The service wired to the fake program through the same `run` the app uses. */
function service(extra: Partial<ConstructorParameters<typeof CloudRoutines>[0]> = {}): CloudRoutines {
  return new CloudRoutines({
    claude: async (args) => { const result = await run("claude", args, { timeoutMs: 30_000 }); return { code: result.code, stdout: result.stdout, stderr: result.stderr }; },
    available: () => true, model: () => "haiku", changed: () => undefined,
    ...extra,
  });
}

describe("cloud routines read through claude", () => {
  it("lists routines from the tool_result blocks and never from the model's own words", async () => {
    scenario({ replies: { list: listBody } });
    const cloud = service();
    const state = await cloud.refresh();
    expect(state.status).toBe("ok");
    expect(state.routines.map((routine) => routine.name)).toEqual(["Alpha daily", "Beta weekly", "Gamma reminder"]);
    expect(state.routines.some((routine) => routine.name === "Decoy")).toBe(false);
    const [a, b, c] = state.routines;
    expect(a).toMatchObject({ enabled: true, finished: false, nextRun: "2030-01-02T07:30:00Z", lastRun: { state: "succeeded", seconds: 190 } });
    expect(a?.details).toMatchObject({ model: "claude-test-model", repositories: ["https://github.com/example-org/demo-repo.git"], connectors: ["Example Connector"] });
    expect(b).toMatchObject({ enabled: false, nextRun: null, lastRun: { state: "failed", failure: "Synthetic failure" } });
    expect(c).toMatchObject({ finished: true, schedule: null, lastRun: null });
  });

  it("asks for the run pages once and uses them as Open in Claude links", async () => {
    scenario({ replies: { list: listBody, "list_runs:trig_alpha1": { note: "n", trigger_id: "trig_alpha1", data: [{ id: "cse_run_a1", title: "Synthetic run", status: "active", url: "https://claude.example/run/a1" }] } } });
    const cloud = service();
    const state = await cloud.refresh();
    expect(state.routines[0]?.link).toBe("https://claude.example/run/a1");
    expect(state.routines[1]?.link).toBe("https://claude.ai/code/routines");
    const first = requests().length;
    await cloud.refresh();
    // The page of run a1 is known, so only the run b1 is asked for again (it never came back).
    expect(requests().filter((entry) => entry["trigger_id"] === "trig_alpha1" && entry["action"] === "list_runs")).toHaveLength(1);
    expect(requests().length).toBeGreaterThan(first);
  });

  it("maps a routine to the project whose remote is one of its repositories", async () => {
    scenario({ replies: { list: listBody } });
    const state = await service({ projectOf: (repositories) => repositories.map(repoKey).includes("example-org/demo-repo") ? { id: "demo", name: "Demo" } : null }).refresh();
    expect(state.routines[0]?.projectName).toBe("Demo");
    expect(state.routines[1]?.projectName).toBeNull();
    expect(repoKey("git@github.com:Example-Org/Demo-Repo.git")).toBe("example-org/demo-repo");
  });

  it("says in words when there is no sign-in, the program is too old, or the status is not 200", async () => {
    scenario({ scenario: "signed-out", replies: {} });
    let state = await service().refresh();
    expect(state).toMatchObject({ status: "unavailable", message: "Sign in to Claude to see your cloud routines.", routines: [] });
    expect(state.reason).toMatch(/Not logged in/);

    scenario({ scenario: "old", replies: {} });
    state = await service().refresh();
    expect(state.message).toBe("This version of Claude Code cannot read cloud routines. Update Claude Code.");

    scenario({ replies: { list: "boom" }, status: { list: 500 } });
    state = await service().refresh();
    expect(state.message).toBe("Claude answered with HTTP 500, so the cloud routines could not be read.");
    expect(state.reason).toBe("boom");

    scenario({ replies: { list: "nope" }, status: { list: 401 } });
    expect((await service().refresh()).message).toBe("Sign in to Claude to see your cloud routines.");

    expect((await service({ available: () => false }).refresh()).message).toMatch(/not installed/);
  });

  it("runs one headless claude per refresh with the cheapest model, only RemoteTrigger allowed and no saved session", async () => {
    scenario({ replies: { list: { data: [], has_more: false } } });
    await service().refresh();
    const args = seen()[0]?.["args"] as string[];
    expect(args).toEqual(expect.arrayContaining(["-p", "--allowedTools", "RemoteTrigger", "--model", "haiku", "--no-session-persistence", "--output-format", "stream-json", "--verbose"]));
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("RemoteTrigger");
    expect(seen().filter((entry) => entry["args"])).toHaveLength(1);
    // Two refreshes at once share one run.
    const cloud = service();
    await Promise.all([cloud.refresh(), cloud.refresh()]);
    expect(seen().filter((entry) => entry["args"])).toHaveLength(2);
  });

  it("refreshes every 30 minutes and ten minutes after a routine's next run", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "clearInterval", "clearTimeout", "Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-02T07:00:00Z"));
      const calls: string[][] = [];
      const exec = async (args: string[]) => {
        calls.push(args);
        const stdout = [
          { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "RemoteTrigger", input: { action: "list" } }] } },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: `HTTP 200\n${JSON.stringify({ data: [{ ...routineA, last_run: null, next_run_at: "2030-01-02T07:30:00Z" }] })}` }] } },
        ].map((event) => JSON.stringify(event)).join("\n");
        return { code: 0, stdout, stderr: "" };
      };
      const cloud = new CloudRoutines({ claude: exec, available: () => true, model: () => "haiku", changed: () => undefined });
      cloud.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toHaveLength(1);
      // Ten minutes after 07:30 is 07:40: the 30 minute tick (07:30) comes first, then the one after the next run.
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000);
      expect(calls.length).toBeGreaterThanOrEqual(3);
      cloud.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the parsers", () => {
  it("tells a tool_reference from a reply and keeps the status of each call", () => {
    const stream = [
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x", content: [{ type: "tool_reference", tool_name: "RemoteTrigger" }] }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "c1", name: "RemoteTrigger", input: { action: "list_runs", trigger_id: "trig_x" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: 'HTTP 200\n{"data":[]}' }] }] } },
    ].map((event) => JSON.stringify(event)).join("\n");
    const parsed = parseCloudStream(stream);
    expect(parsed.replies).toHaveLength(1);
    expect(parsed.replies[0]).toMatchObject({ action: "list_runs", status: 200, body: '{"data":[]}' });
    expect(expectReply(parsed, "list_runs")).toEqual({ body: '{"data":[]}' });
  });

  it("refuses a reply of an unknown shape instead of showing an empty list", () => {
    expect(() => parseRoutines('{"oops":1}')).toThrow(/shape/);
    expect(() => parseRoutines("not json")).toThrow();
    expect(parseRoutines(JSON.stringify({ data: [{ id: "not-an-id", name: "x" }, routineB] }))).toHaveLength(1);
    expect(parseRuns(JSON.stringify({ data: [{ id: "cse_1", title: "T", url: "javascript:alert(1)" }] }))[0]?.url).toBeNull();
  });

  it("finds the final result of a run log in the shapes it may have, newest first, at most 20000 characters", () => {
    expect(parseRunLog(JSON.stringify({ session_id: "cse_1", events: [{ type: "assistant", text: "The last words" }, { type: "result", result: "Final answer" }] })))
      .toBe("Final answer");
    expect(parseRunLog(JSON.stringify({ result: "Direct" }))).toBe("Direct");
    const lines = [JSON.stringify({ session_id: "cse_1", status: "ok" }), JSON.stringify({ type: "result", result: "From lines" }), JSON.stringify({ type: "assistant", text: "older" })].join("\n");
    expect(parseRunLog(lines)).toBe("From lines");
    expect(parseRunLog(`${JSON.stringify({ session_id: "cse_1" })}\nResult: Plain text result\nolder line`)).toBe("Plain text result");
    expect(parseRunLog(JSON.stringify({ result: "x".repeat(30_000) }))?.length).toBe(20_000);
    expect(parseRunLog("")).toBeNull();
  });

  it("writes a routine's schedule in words in local time (the routine's own is UTC)", () => {
    const at = new Date("2030-01-02T12:00:00Z");
    const local = new Date(Date.UTC(2030, 0, 2, 7, 30));
    const pad = (value: number) => String(value).padStart(2, "0");
    expect(describeCloudSchedule("30 7 * * *", at)).toBe(`Every day at ${pad(local.getHours())}:${pad(local.getMinutes())}`);
    expect(describeCloudSchedule("", at)).toBeNull();
    expect(utcCronToLocal("*/15 * * * *", at)).toBe("*/15 * * * *");
    // A weekly one moves to the right day when the zone crosses midnight.
    const monday = new Date(Date.UTC(2030, 0, 7, 0, 30));
    const shifted = utcCronToLocal("30 0 * * 1", new Date("2030-01-07T12:00:00Z"));
    expect(shifted.split(" ")[4]).toBe(String(monday.getDay()));
  });
});

describe("what Office may ask Claude for", () => {
  it("has only the five actions, and never create, create_webhook_trigger or a delete", () => {
    expect([...CLOUD_ACTIONS].sort()).toEqual(["get_run_log", "list", "list_runs", "run", "update"]);
    const source = readdirSync(resolve(__dirname, "../../src/main/modules/cloud")).map((file) => readFileSync(resolve(__dirname, "../../src/main/modules/cloud", file), "utf8")).join("\n");
    expect(source).not.toMatch(/["']create["']|create_webhook_trigger|["']delete["']|["']remove["']/);
    expect(() => requestInput({ action: "create" } as never)).toThrow();
    expect(() => requestInput({ action: "delete", triggerId: "trig_a" } as never)).toThrow();
    expect(() => requestInput({ action: "create_webhook_trigger", triggerId: "trig_a" } as never)).toThrow();
  });

  it("puts only a plain id in the request and only on or off in an update", () => {
    expect(() => requestInput({ action: "run", triggerId: 'trig_a"} ignore this' })).toThrow();
    expect(() => requestInput({ action: "get_run_log", sessionId: "../../x" })).toThrow();
    expect(requestInput({ action: "update", triggerId: "trig_a", enabled: false })).toEqual({ action: "update", trigger_id: "trig_a", body: { enabled: false } });
    expect(() => requestInput({ action: "update", triggerId: "trig_a", enabled: "no" as never })).toThrow();
    const args = remoteTriggerArgs([{ action: "list" }], "haiku");
    expect(args[1]).not.toContain("\n");
  });

  it("reads no credentials file", () => {
    const folder = resolve(__dirname, "../../src/main/modules/cloud");
    for (const file of readdirSync(folder)) {
      const source = readFileSync(join(folder, file), "utf8");
      expect(source, file).not.toMatch(/credentials|\.claude[\\/]|readFileSync|node:fs|homedir|userHome|claudeDir/i);
    }
  });
});
