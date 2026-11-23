import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import type { StreamHandle } from "../../src/main/core/exec";
import { ClaudeChatParser, CodexChatParser } from "../../src/main/modules/chat/events";
import { parseClaudeLine, parseCodexLine, startAgentRun } from "../../src/main/modules/providers/stream";
import type { Provider } from "../../src/main/modules/providers/types";
import { RunService, type RunServiceDeps } from "../../src/main/modules/runs/service";
import { UsageService, type UsageNames } from "../../src/main/modules/usage/usage";
import { tmp } from "../fixtures/repos/make";

const fixture = (name: string): string[] => readFileSync(join(__dirname, "../fixtures/streams", name), "utf8").split("\n").filter(Boolean);

function stream(lines: string[]): StreamHandle {
  return {
    lines: (async function* () { yield* lines; })(),
    exit: Promise.resolve({ code: 0, stderr: "" }),
    kill: () => undefined,
    write: () => undefined,
  };
}

const names: UsageNames = {
  project: (id) => (id === "alpha" ? "Alpha" : undefined),
  session: (id) => (id === "s1" ? { title: "Fix the bug", projectId: "alpha" } : undefined),
  workflow: (id) => (id === "wf" ? "Weekly watch" : undefined),
};

describe("what the programs report", () => {
  it("a Claude result line gives the counts and cost it reports, per model", async () => {
    const run = startAgentRun(stream(fixture("claude-usage.jsonl")), parseClaudeLine);
    const done = await run.done;
    expect(done.usage).toEqual([{
      model: "claude-haiku-4-5-20251001", inputTokens: 1234, outputTokens: 42, cacheReadTokens: 789, cacheWriteTokens: 56,
      costUsd: 0.0015929, durationMs: 93,
    }]);
    expect(done.limits?.map((window) => [window.key, window.utilization])).toEqual([["five_hour", 0.42], ["seven_day", 0.81]]);
    expect(done.limits?.find((window) => window.key === "seven_day")).toMatchObject({ label: "Weekly limit", status: "allowed_warning" });
    expect(done.limits?.[0]?.resetsAt).toBe(new Date(1795448978 * 1000).toISOString());
  });

  it("a Codex turn gives the counts it reports and no cost, with cached tokens counted once", async () => {
    const done = await startAgentRun(stream(fixture("codex-usage.jsonl")), parseCodexLine).done;
    expect(done.usage).toEqual([{
      model: null, inputTokens: 1500, outputTokens: 30, cacheReadTokens: 500, cacheWriteTokens: 0, costUsd: null, durationMs: null,
    }]);
    // 1500 + 500 cached = the 2000 input tokens it reported; plus 30 output is its own total of 2030.
    const [report] = done.usage!;
    expect(report!.inputTokens + report!.cacheReadTokens + report!.outputTokens).toBe(2030);
    expect(done.limits).toBeUndefined();
  });

  it("the chat parsers carry the same figures on the result of a turn", () => {
    const claude = new ClaudeChatParser();
    const events = fixture("claude-usage.jsonl").flatMap((line) => claude.parse(line));
    const result = events.find((event) => event.t === "result");
    expect(result).toMatchObject({ t: "result", ok: true, usage: [{ inputTokens: 1234, outputTokens: 42, cacheReadTokens: 789, cacheWriteTokens: 56 }] });
    expect(claude.limits).toHaveLength(2);
    const codex = new CodexChatParser();
    const turn = fixture("codex-usage.jsonl").flatMap((line) => codex.parse(line)).find((event) => event.t === "result");
    expect(turn).toMatchObject({ t: "result", usage: [{ inputTokens: 1500, outputTokens: 30, cacheReadTokens: 500 }] });
  });

  it("a stream that reports nothing records nothing", async () => {
    const done = await startAgentRun(stream(['{"type":"result","is_error":false,"result":"ok"}']), parseClaudeLine).done;
    expect(done.usage).toBeUndefined();
  });
});

describe("the usage totals", () => {
  it("add up exactly what fixture streams reported, by project, kind, model and program", async () => {
    const db = openDb(":memory:");
    const now = new Date(2026, 10, 23, 12, 0);
    const usage = new UsageService({ db, now: () => now });
    const claude = (await startAgentRun(stream(fixture("claude-usage.jsonl")), parseClaudeLine).done).usage!;
    const codex = (await startAgentRun(stream(fixture("codex-usage.jsonl")), parseCodexLine).done).usage!;
    usage.record({ provider: "claude-code", kind: "chat", projectId: "alpha", sessionId: "s1" }, claude);
    usage.record({ provider: "claude-code", kind: "chat", projectId: "alpha", sessionId: "s1" }, claude);
    usage.record({ provider: "codex", kind: "workflow", projectId: null, workflowId: "wf", runId: "r1", model: "gpt-5.4" }, codex);
    const view = usage.summary(names);
    expect(view.today).toMatchObject({ turns: 3, inputTokens: 1234 * 2 + 1500, outputTokens: 42 * 2 + 30, cacheReadTokens: 789 * 2 + 500, cacheWriteTokens: 112 });
    expect(view.today.costUsd).toBeCloseTo(0.0031858, 7);
    expect(view.today.tokens).toBe((1234 + 42 + 789 + 56) * 2 + 2030);
    expect(view.month.tokens).toBe(view.today.tokens);
    expect(view.byProject.map((row) => [row.label, row.totals.turns])).toEqual([["Alpha", 2], ["No project", 1]]);
    expect(view.byKind.map((row) => row.label).sort()).toEqual(["Chat and sessions", "Workflows"]);
    expect(view.byModel.map((row) => row.label).sort()).toEqual(["claude-haiku-4-5-20251001", "gpt-5.4"]);
    expect(view.byProgram.map((row) => row.label).sort()).toEqual(["Claude Code", "Codex"]);
    expect(view.sessions).toMatchObject([{ label: "Fix the bug", link: { view: "agents", params: { session: "s1" } } }]);
    expect(view.workflows).toMatchObject([{ label: "Weekly watch", link: { view: "workflows" } }]);
    expect(usage.forSession("s1").tokens).toBe((1234 + 42 + 789 + 56) * 2);
    expect(usage.forRun("r1").tokens).toBe(2030);
    expect(view.daily).toHaveLength(30);
    expect(view.daily.at(-1)).toMatchObject({ day: "2026-11-23", tokens: view.today.tokens });
    db.close();
  });

  it("keeps older days out of today and the week, and drops an empty report", () => {
    const db = openDb(":memory:");
    let now = new Date(2026, 10, 10, 9, 0);
    const usage = new UsageService({ db, now: () => now });
    const report = { model: "m", inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.1, durationMs: null };
    usage.record({ provider: "claude-code", kind: "brief" }, [report]);
    usage.record({ provider: "claude-code", kind: "brief" }, [{ ...report, inputTokens: 0, outputTokens: 0, costUsd: null }]);
    now = new Date(2026, 10, 23, 9, 0);
    usage.record({ provider: "claude-code", kind: "recorder" }, [report]);
    const view = usage.summary(names);
    expect(view.today.turns).toBe(1);
    expect(view.week.turns).toBe(1);
    expect(view.month.turns).toBe(2);
    expect(view.byProject[0]?.label).toBe("No project");
    now = new Date(2026, 11, 30, 9, 0);
    expect(usage.summary(names).month.turns).toBe(0);
    db.close();
  });

  it("keeps the latest plan windows and drops a window once it has reset", () => {
    const db = openDb(":memory:");
    let now = new Date("2026-11-23T10:00:00Z");
    const usage = new UsageService({ db, now: () => now });
    usage.setLimits("claude-code", [
      { key: "five_hour", label: "5-hour window", utilization: 0.4, resetsAt: "2026-11-23T13:00:00.000Z", status: null },
      { key: "seven_day", label: "Weekly limit", utilization: 0.8, resetsAt: "2026-11-27T13:00:00.000Z", status: "allowed_warning" },
    ]);
    now = new Date("2026-11-23T11:00:00Z");
    usage.setLimits("claude-code", [{ key: "five_hour", label: "5-hour window", utilization: 0.55, resetsAt: "2026-11-23T13:00:00.000Z", status: null }]);
    expect(usage.limits("claude-code").windows.map((window) => [window.key, window.utilization])).toEqual([["five_hour", 0.55], ["seven_day", 0.8]]);
    now = new Date("2026-11-23T14:00:00Z");
    expect(usage.limits("claude-code").windows.map((window) => window.key)).toEqual(["seven_day"]);
    expect(usage.limits("codex").windows).toEqual([]);
    expect(usage.summary(names).limits.claudeCode).toHaveLength(1);
    db.close();
  });
});

describe("a background run records its usage", () => {
  it("counts a workflow run under its workflow, and Upkeep as upkeep", async () => {
    const db = openDb(":memory:");
    const runsDir = tmp("office-usage-runs-");
    const usage = new UsageService({ db });
    const reports = (await startAgentRun(stream(fixture("claude-usage.jsonl")), parseClaudeLine).done).usage!;
    const provider = {
      headless: () => ({
        events: (async function* () { /* nothing */ })(),
        done: Promise.resolve({ ok: true, resultText: "ok", usage: reports, limits: [{ key: "five_hour", label: "5-hour window", utilization: 0.3, resetsAt: null, status: null }] }),
        cancel: () => undefined,
      }),
    } as unknown as Provider;
    const service = new RunService({
      db, bus: new Bus(), providers: { get: () => provider }, runsDir, usage,
    } as unknown as RunServiceDeps);
    const first = service.start({ kind: "workflow", providerId: "claude-code", cwd: ".", prompt: "x", workflowId: "wf", projectId: "alpha" });
    await first.result;
    const second = service.start({ kind: "workflow", providerId: "claude-code", cwd: ".", prompt: "x", workflowId: "upkeep", usageKind: "upkeep" });
    await second.result;
    const view = usage.summary(names);
    expect(view.byKind.map((row) => [row.label, row.totals.turns]).sort()).toEqual([["Upkeep", 1], ["Workflows", 1]]);
    expect(usage.forRun(first.id).tokens).toBe(1234 + 42 + 789 + 56);
    expect(usage.limits("claude-code").windows).toHaveLength(1);
    db.close();
    rmSync(runsDir, { recursive: true, force: true });
  });
});
