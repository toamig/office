import { describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { PendingService, type PendingSources } from "../../src/main/modules/pending/service";
import type { SessionRow, SyncReport, TaskView } from "../../src/shared/models";

const session = (over: Partial<SessionRow>): SessionRow =>
  ({
    id: "s1",
    provider: "fake",
    title: "Asker",
    projectId: "alpha",
    status: "needs-you",
    archivedAt: null,
    ...over,
  }) as SessionRow;

function make(over: Partial<PendingSources> = {}) {
  const bus = new Bus();
  const events: unknown[] = [];
  bus.on("pending.changed", (e) => events.push(e.payload));
  const sources: PendingSources = {
    sessions: () => [],
    tasks: () => [],
    permissions: () => [],
    projects: () => [],
    waiting: () => [],
    github: () => [],
    ...over,
  };
  const service = new PendingService({ db: openDb(":memory:"), bus, sources });
  return { service, bus, events };
}

describe("pending items", () => {
  it("exist exactly while their state is unresolved, most serious first", () => {
    let sessions = [
      session({ id: "a", status: "needs-you" }),
      session({ id: "b", status: "failed", title: "Builder" }),
    ];
    const { service } = make({ sessions: () => sessions });
    const items = service.list();
    expect(items.map((i) => [i.kind, i.severity])).toEqual([
      ["agent-failed", "danger"],
      ["agent-needs-you", "attention"],
    ]);
    expect(PendingService.worst(items)).toBe("danger");
    // The failed one is resolved (the session is idle again) and is simply gone, with no trace.
    sessions = [
      session({ id: "a", status: "needs-you" }),
      session({ id: "b", status: "idle", title: "Builder" }),
    ];
    expect(service.list().map((i) => i.kind)).toEqual(["agent-needs-you"]);
    sessions = [];
    expect(service.list()).toEqual([]);
    expect(PendingService.worst([])).toBeNull();
  });

  it("does not list archived sessions, terminals, or a task that is running or done", () => {
    const task = (status: string): TaskView =>
      ({
        id: "t",
        title: "T",
        status,
        stageIndex: 0,
        stages: [{ stageId: "plan" }],
        projectId: "alpha",
        projectName: "Alpha",
        pipelineName: "Feature",
      }) as TaskView;
    let tasks = [task("running")];
    const { service } = make({
      sessions: () => [
        session({ archivedAt: "2026-11-19" }),
        session({ id: "x", provider: "terminal" }),
      ],
      tasks: () => tasks,
    });
    expect(service.list()).toEqual([]);
    tasks = [task("waiting-gate")];
    expect(service.list().map((i) => i.kind)).toEqual(["task-gate"]);
    tasks = [task("done")];
    expect(service.list()).toEqual([]);
  });

  it("hide on Dismiss until the state behind them changes", () => {
    let status: SessionRow["status"] = "needs-you";
    const { service } = make({ sessions: () => [session({ status })] });
    const [item] = service.list();
    service.dismiss(item!.key, item!.fingerprint);
    expect(service.list()).toEqual([]);
    // Resolved and then pending again for a new reason: it comes back.
    status = "idle";
    expect(service.list()).toEqual([]);
    status = "failed";
    expect(service.list().map((i) => i.kind)).toEqual(["agent-failed"]);
    status = "needs-you";
    expect(service.list().map((i) => i.kind)).toEqual(["agent-needs-you"]);
  });

  it("keep a sync conflict or a failed push until a later sync of that repo is fine", () => {
    const { service } = make();
    const report = (action: SyncReport["repos"][number]["action"], extra = {}): SyncReport =>
      ({ repos: [{ id: "alpha", name: "Alpha", action, ...extra }] }) as SyncReport;
    service.onSyncReport(report("conflict", { reason: "Both changed README.md" }));
    expect(service.list().map((i) => [i.kind, i.detail])).toEqual([
      ["conflict", "Both changed README.md"],
    ]);
    // A repeated report is still one item.
    service.onSyncReport(report("conflict", { reason: "Both changed README.md" }));
    expect(service.list()).toHaveLength(1);
    service.onSyncReport(report("failed", { pushFailed: true, reason: "rejected" }));
    expect(service.list().map((i) => i.kind)).toEqual(["push-failed"]);
    service.onSyncReport(report("up-to-date"));
    expect(service.list()).toEqual([]);
  });

  it("tell the app when the list changed, once things are quiet, and not when it did not", async () => {
    let sessions: SessionRow[] = [];
    const { bus, events } = make({ sessions: () => sessions });
    sessions = [session({})];
    bus.emit("session.status", { id: "s1", status: "needs-you" });
    bus.emit("session.status", { id: "s1", status: "needs-you" });
    await new Promise((r) => setTimeout(r, 200));
    expect(events).toEqual([{ count: 1 }]);
    bus.emit("session.status", { id: "s1", status: "needs-you" });
    await new Promise((r) => setTimeout(r, 200));
    expect(events).toHaveLength(1);
    sessions = [];
    bus.emit("session.status", { id: "s1", status: "idle" });
    await new Promise((r) => setTimeout(r, 200));
    expect(events).toEqual([{ count: 1 }, { count: 0 }]);
  });
});
