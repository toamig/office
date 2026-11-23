import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_FLAG, staysInTray, startedHidden, startsWithWindows } from "../../src/main/core/background";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import type { Notifier } from "../../src/main/core/notifier";
import { commitsMade, Scheduler, workflowRequest } from "../../src/main/core/scheduler";
import { claudeHeadlessArgs, claudePath, sessionSettings } from "../../src/main/modules/providers/claude-code";
import type { Provider, RunOptions } from "../../src/main/modules/providers/types";
import { RunService, type RunServiceDeps } from "../../src/main/modules/runs/service";
import { Workspace } from "../../src/shared/schemas";
import {
  choiceFromSchedule, describeNext, describeSchedule, nextRuns, scheduleFromChoice, validCron,
} from "../../src/shared/schedule";
import { Workflow } from "../../src/shared/workflow";
import { commit, sh, tmp, write } from "../fixtures/repos/make";

let root: string;
beforeEach(() => { root = tmp("office-workflow-act-"); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const project = { id: "alpha", name: "Alpha", path: "Code", vault: "Projects/Alpha" };
const config = {
  version: 1, vault: { kind: "folder" }, projects: [project, { ...project, id: "secret", vault: "Projects/Secret" }],
  roles: {}, pipelines: {}, notifications: { urgent: [] },
};
const base = Workflow.parse({ id: "notes", name: "Notes", schedule: "0 9 * * 1", projectId: "alpha", prompt: "Write notes", read: "brain" });

describe("schedules in plain words", () => {
  it("builds and reads back each kind of schedule", () => {
    const cases: Array<[Parameters<typeof scheduleFromChoice>[0], string, string]> = [
      [{ kind: "daily", time: "08:30" }, "30 8 * * *", "Every day at 08:30"],
      [{ kind: "weekdays", time: "09:00" }, "0 9 * * 1-5", "Weekdays at 09:00"],
      [{ kind: "days", days: [3, 1], time: "07:15" }, "15 7 * * 1,3", "Every Monday and Wednesday at 07:15"],
      [{ kind: "hours", every: 6 }, "0 */6 * * *", "Every 6 hours"],
    ];
    for (const [choice, cron, words] of cases) {
      expect(scheduleFromChoice(choice)).toBe(cron);
      expect(describeSchedule(cron)).toBe(words);
      expect(scheduleFromChoice(choiceFromSchedule(cron))).toBe(cron);
    }
    expect(scheduleFromChoice({ kind: "manual" })).toBeNull();
    expect(describeSchedule(null)).toBe("On demand");
    expect(describeSchedule("0 9 * * 1")).toBe("Every Monday at 09:00");
    expect(choiceFromSchedule("5 4 1 */2 *").kind).toBe("custom");
    expect(validCron("not a schedule")).toBe(false);
    expect(validCron("0 9 * * 1")).toBe(true);
  });

  it("lists the next three runs and words the next one", () => {
    const from = new Date(2026, 10, 25, 10, 0);
    const runs = nextRuns("0 9 * * 1", 3, from);
    expect(runs).toHaveLength(3);
    expect(describeNext(runs[0]!, from)).toBe("Monday 09:00");
    expect(describeNext(new Date(2026, 10, 26, 8, 0), from)).toBe("tomorrow 08:00");
    expect(nextRuns("nonsense", 3, from)).toEqual([]);
  });
});

describe("what a workflow may do", () => {
  const ws = () => Workspace.parse(config);

  it("a read-only workflow cannot write: no edit tools, a read-only role, nothing to ask", () => {
    write(root, "Projects/Alpha/Overview.md", "# Alpha");
    const request = workflowRequest(base, ws(), root, join(root, "Code"), root, "claude-code");
    expect(request.role?.readOnly).toBe(true);
    expect(request.tools).not.toMatch(/Edit|Write|Bash/);
    expect(request.brain?.writable).toEqual([]);
    expect(request.role?.model).toBe("haiku");
  });

  it("a workflow set to Write in the brain can edit only inside the brain and commit in its folders", () => {
    write(root, "Projects/Secret/brain.json", '{"private":true}');
    mkdirSync(join(root, "Projects/Alpha"), { recursive: true });
    const code = join(root, "Code");
    const request = workflowRequest({ ...base, mayDo: "brain" }, ws(), root, code, root, "claude-code");
    const own = join(root, "Projects", "Alpha");
    expect(request.role?.readOnly).toBe(false);
    expect(request.role?.model).toBe("sonnet");
    expect(request.cwd).toBe(root);
    expect(request.brain?.writable).toEqual([own]);
    const rules = request.role?.allowedCommands ?? [];
    const edits = rules.filter((rule) => rule.startsWith("Edit"));
    expect(edits).toEqual([`Edit(${claudePath(own)}/**)`]);
    expect(rules.join("\n")).not.toContain(claudePath(code));
    expect(rules.some((rule) => /^Bash\(git -C .*Projects\/Alpha add:\*\)$/.test(rule))).toBe(true);
    expect(rules.some((rule) => /push|reset|rebase|rm /.test(rule))).toBe(false);
    expect(request.tools).toMatch(/Edit,Write,Bash/);
    // Every other folder and the private one are shut to edits and reads by the session settings.
    const flags = sessionSettings({ brain: request.brain!, role: request.role! });
    const settings = JSON.parse(flags[flags.indexOf("--settings") + 1]!) as { permissions: { deny: string[] } };
    expect(settings.permissions.deny).toContain(`Read(${claudePath(join(root, "Projects/Secret"))}/**)`);
    expect(settings.permissions.deny).toContain(`Edit(${claudePath(join(root, "_index.md"))})`);
    const args = claudeHeadlessArgs({
      cwd: root, officeSessionId: "x", prompt: "p", permission: { kind: "allowlist" }, role: request.role!, tools: request.tools!,
    }, []);
    const allowed = args.slice(args.indexOf("--allowedTools") + 1);
    expect(allowed.some((rule) => rule.startsWith("Edit(") && !rule.includes("Projects/Alpha"))).toBe(false);
    expect(allowed.some((rule) => rule.startsWith("Edit("))).toBe(true);
  });

  it("the run service gives a writing workflow an allow list and a read-only one no way to write", async () => {
    const seen: Array<RunOptions | undefined> = [];
    const provider = {
      headless: (options: RunOptions) => {
        seen.push(options);
        return { events: (async function* () { /* nothing */ })(), done: Promise.resolve({ ok: true, resultText: "ok" }), cancel: () => undefined };
      },
    } as unknown as Provider;
    const service = new RunService({
      db: openDb(":memory:"), bus: new Bus(), providers: { get: () => provider }, runsDir: join(root, "runs"),
    } as unknown as RunServiceDeps);
    mkdirSync(join(root, "Projects/Alpha"), { recursive: true });
    const writing = workflowRequest({ ...base, mayDo: "brain" }, ws(), root, join(root, "Code"), root, "claude-code");
    const reading = workflowRequest(base, ws(), root, join(root, "Code"), root, "claude-code");
    await service.start(writing).result;
    await service.start(reading).result;
    expect(seen[0]?.permission?.kind).toBe("allowlist");
    expect(seen[1]?.permission?.kind).toBe("readonly");
  });

  it("a workflow that works in its project edits only that folder, and Full auto needs the owner's confirmation", () => {
    const code = join(root, "Code");
    const act = workflowRequest({ ...base, mayDo: "project", read: "project" }, ws(), root, code, root, "claude-code");
    expect(act.cwd).toBe(code);
    expect(act.role?.autonomy).toBe("act-on-risk");
    expect(act.role?.allowedCommands).toContain(`Edit(${claudePath(code)}/**)`);
    expect(act.role?.allowedCommands.filter((rule) => rule.startsWith("Edit"))).toHaveLength(1);
    const full = { ...base, mayDo: "project" as const, read: "project" as const, autonomy: "full-auto" as const };
    expect(workflowRequest(full, ws(), root, code, root, "claude-code").role?.autonomy).toBe("act-on-risk");
    const confirmed = workflowRequest(full, ws(), root, code, root, "claude-code", undefined, { fullAutoConfirmed: true });
    expect(confirmed.role?.autonomy).toBe("full-auto");
    expect(confirmed.role?.deniedCommands).toBeUndefined();
    expect(workflowRequest({ ...full, web: false }, ws(), root, code, root, "claude-code", undefined, { fullAutoConfirmed: true }).role?.deniedCommands)
      .toEqual(["WebSearch", "WebFetch"]);
  });

  it("web search is its own switch", () => {
    const on = workflowRequest(base, ws(), root, join(root, "Code"), root, "claude-code");
    const off = workflowRequest({ ...base, web: false }, ws(), root, join(root, "Code"), root, "claude-code");
    expect(on.tools).toBe("Read,Grep,Glob,WebSearch,WebFetch");
    expect(off.tools).toBe("Read,Grep,Glob");
  });

  it("lists the commits a workflow made", async () => {
    const repo = tmp("office-workflow-commits-");
    try {
      sh(repo, "init", "-q");
      commit(repo, "a.md", "one", "First note");
      const before = new Map([[repo, sh(repo, "rev-parse", "HEAD").trim()]]);
      commit(repo, "b.md", "two", "Add the second note");
      const lines = await commitsMade([repo], before);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("Add the second note");
      expect(await commitsMade([repo], new Map([[repo, sh(repo, "rev-parse", "HEAD").trim()]]))).toEqual([]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});

describe("a missed run", () => {
  it("fires once at the next start and is marked late, not once per tick", async () => {
    const db = openDb(join(root, "office.db"));
    let time = new Date(2026, 10, 20, 8, 0);
    const start = vi.fn(() => ({ id: "run", result: Promise.resolve({ ok: true, resultText: "Done" }) }));
    const daily = Workflow.parse({ id: "daily", name: "Daily", schedule: "0 9 * * *", projectId: null, prompt: "Do it", read: "none", output: "note" });
    const scheduler = new Scheduler({
      db, notifier: { notify: vi.fn() } as unknown as Notifier, root: () => root, neutralFolder: () => root,
      defaultProvider: () => "fake", projectPath: () => undefined,
      workspace: () => Workspace.parse({ ...config, workflows: [daily] }),
      runs: { start } as unknown as RunService, output: async () => undefined, now: () => time,
    });
    scheduler.tick(); // first sight of the workflow only records the time
    expect(start).not.toHaveBeenCalled();
    time = new Date(2026, 10, 23, 7, 0); // Office was closed over three 09:00 slots
    time = new Date(2026, 10, 23, 7, 0);
    for (let i = 0; i < 4; i += 1) {
      scheduler.tick();
      time = new Date(time.getTime() + 30_000);
    }
    await vi.waitFor(() => expect(scheduler.list()[0]?.lastRun?.status).toBe("done"));
    expect(start).toHaveBeenCalledTimes(1);
    const view = scheduler.list()[0]!;
    expect(view.lastRun?.lateFor).not.toBeNull();
    expect(new Date(view.lastRun!.lateFor!).getHours()).toBe(9);
    expect(view.upcoming).toHaveLength(3);
    // A run that fires on time is not late.
    time = new Date(2026, 10, 23, 9, 0, 10);
    scheduler.tick();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(scheduler.list()[0]?.lastRun?.lateFor).toBeNull());
    db.close();
  });
});

describe("when Office is closed", () => {
  it("starts with Windows and stays in the tray once a scheduled workflow is on, unless the owner chose otherwise", () => {
    const off = Workspace.parse(config);
    const on = Workspace.parse({ ...config, workflows: [{ ...base, enabled: true }] });
    const manual = Workspace.parse({ ...config, workflows: [{ ...base, schedule: null, enabled: true }] });
    expect(startsWithWindows(undefined, off)).toBe(false);
    expect(startsWithWindows(undefined, on)).toBe(true);
    expect(startsWithWindows(undefined, manual)).toBe(false);
    expect(startsWithWindows(false, on)).toBe(false);
    expect(staysInTray(on)).toBe(true);
    expect(staysInTray(off)).toBe(false);
    expect(startedHidden(["Office.exe", HIDDEN_FLAG])).toBe(true);
  });
});
