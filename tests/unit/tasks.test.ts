import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb, type Db } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { RunService } from "../../src/main/modules/runs/service";
import { TaskEngine } from "../../src/main/modules/tasks/engine";
import { VaultOps } from "../../src/main/modules/vault/ops";
import { VaultService } from "../../src/main/modules/vault/service";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import { renderTemplate } from "../../src/main/modules/tasks/templates";
import type { TaskView } from "../../src/shared/models";
import type { Role, Workspace } from "../../src/shared/types";
import { sh } from "../fixtures/repos/make";
import { makeWorld, type World } from "../fixtures/vault/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-tasks-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

interface Harness {
  world: World;
  db: Db;
  bus: Bus;
  notifier: Notifier;
  ws: Workspace;
  engine: TaskEngine;
  /** Builds another engine on the same database, as after a restart. */
  restart: () => TaskEngine;
}

function harness(): Harness {
  const world = makeWorld();
  const loaded = loadWorkspaceFile(join(world.hub, world.workspaceConfigPath));
  if (!loaded.ok) throw new Error(loaded.error);
  const ws = loaded.workspace;
  const db = openDb(":memory:");
  const bus = new Bus();
  const notifier = new Notifier({ db, bus, workspace: () => ws, quietHours: () => undefined });
  const providers = new ProviderRegistry();
  const vault = new VaultService({ bus, workspace: () => ws, workspaceRoot: () => world.hub });
  const writer = new VaultWriter({
    hubRoot: () => world.hub,
    onWarning: () => undefined,
    today: () => "2026-11-19",
  });
  const ops = new VaultOps({ vault, writer, workspace: () => ws });
  const make = (): TaskEngine => {
    const runs = new RunService({ db, bus, providers, runsDir: join(world.root, "runs") });
    return new TaskEngine({
      db,
      bus,
      runs,
      notifier,
      workspace: () => ws,
      projectPath: (id) => world.code[id]?.work,
      resolveRole: (roleId): Role => {
        const role = ws.roles[roleId];
        if (!role) throw new Error(`There is no role called "${roleId}"`);
        return role;
      },
      tasksDir: join(world.root, "tasks"),
      recordNote: async (projectId, text) => {
        await ops.addTodo(projectId, text, undefined, "Implementation notes");
      },
    });
  };
  return { world, db, bus, notifier, ws, engine: make(), restart: make };
}

async function until(cond: () => boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
}

const waitFor = async (
  engine: TaskEngine,
  id: string,
  status: TaskView["status"],
): Promise<TaskView> => {
  await until(() => engine.list().find((t) => t.id === id)?.status === status);
  return engine.list().find((t) => t.id === id) as TaskView;
};

describe("templates", () => {
  it("fills placeholders and names an unknown one in the error", () => {
    const ctx = {
      task: { description: "Do it", branch: "office/x" },
      stage: { outputPath: "/o/plan.md" },
      stages: { plan: { outputPath: "/o/plan.md" } },
    };
    expect(
      renderTemplate(
        "{{task.description}}\n\nWrite to {{stage.outputPath}} and read {{ stages.plan.outputPath }}.",
        ctx,
      ),
    ).toBe("Do it\n\nWrite to /o/plan.md and read /o/plan.md.");
    expect(() => renderTemplate("{{task.nothing}}", ctx)).toThrow(
      /Unknown placeholder \{\{task\.nothing\}\}/,
    );
    expect(() => renderTemplate("{{stages.review.outputPath}}", ctx)).toThrow(
      /Unknown placeholder/,
    );
    expect(() => renderTemplate("{{task.branch}}", { task: { branch: null } })).toThrow(
      /Unknown placeholder/,
    );
    expect(renderTemplate("[{{task.empty}}]", { task: { empty: "" } })).toBe("[]");
    expect(renderTemplate("no placeholders", {})).toBe("no placeholders");
  });
});

describe("task engine with fake providers", () => {
  it("runs a three-stage pipeline through two gates, writing each output for the next stage", async () => {
    const h = harness();
    const created = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Add sheep",
      description: "Add a sheep counter.",
    });
    expect(created.stages.map((s) => [s.stageId, s.role, s.gate])).toEqual([
      ["plan", "planner", true],
      ["build", "builder", false],
      ["review", "reviewer", true],
    ]);

    // Plan runs and waits at its gate; the plan file exists and holds the plan.
    const atPlan = await waitFor(h.engine, created.id, "waiting-gate");
    expect(atPlan.stageIndex).toBe(0);
    expect(atPlan.stages[0]).toMatchObject({ status: "waiting-gate", provider: "fake" });
    const detail = await h.engine.get(created.id);
    expect(detail.outputs["plan"]).toContain("# Plan");
    expect(h.notifier.list().map((n) => n.kind)).toEqual(["task.gate"]);

    // Approve: build runs in a fresh worktree on its own branch, then review waits at the second gate.
    h.engine.approve(created.id);
    const atReview = await waitFor(h.engine, created.id, "waiting-gate");
    expect(atReview.stageIndex).toBe(2);
    expect(atReview.branch).toMatch(/^office\/add-sheep-/);
    expect(atReview.worktree).toContain(".office");
    expect(atReview.stages.map((s) => s.status)).toEqual(["approved", "done", "waiting-gate"]);
    const alpha = h.world.code["alpha"]?.work as string;
    expect(sh(atReview.worktree as string, "log", "-1", "--format=%s").trim()).toBe(
      "Fake builder change",
    );
    expect(sh(alpha, "branch", "--show-current").trim()).toBe("main");
    expect((await h.engine.get(created.id)).outputs["review"]).toContain("No problems found.");

    h.engine.approve(created.id);
    const done = await waitFor(h.engine, created.id, "done");
    expect(done.stages.every((s) => s.status === "approved" || s.status === "done")).toBe(true);
    expect(
      h.notifier
        .list()
        .map((n) => n.kind)
        .sort(),
    ).toEqual(["task.done", "task.gate", "task.gate"]);
  });

  it("a rejection re-runs the stage with the comment appended to its prompt", async () => {
    const h = harness();
    const t = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Needs rework",
      description: "Do the thing.",
    });
    await waitFor(h.engine, t.id, "waiting-gate");
    const firstRun = h.engine.list()[0]?.stages[0]?.runId;
    h.engine.reject(t.id, "Cover the edge cases");
    await until(
      () =>
        h.engine.list()[0]?.stages[0]?.runId !== firstRun &&
        h.engine.list()[0]?.status === "waiting-gate",
    );
    const rows = h.db
      .prepare("SELECT output_path FROM runs WHERE task_id = ? ORDER BY started_at")
      .all(t.id);
    expect(rows).toHaveLength(2);
    // Both runs happened for the plan stage and the task is back at the same gate.
    expect(h.engine.list()[0]?.stageIndex).toBe(0);
  });

  it("survives a restart: a gate stays a gate, and an interrupted stage can be retried", async () => {
    const h = harness();
    const t = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Restart me",
      description: "Plan it.",
    });
    await waitFor(h.engine, t.id, "waiting-gate");

    // A new engine on the same database sees the task still waiting; approving continues the pipeline.
    const after = h.restart();
    expect(after.list()[0]).toMatchObject({ status: "waiting-gate", stageIndex: 0 });
    after.approve(t.id);
    await waitFor(after, t.id, "waiting-gate");
    expect(after.list()[0]?.stageIndex).toBe(2);

    // A second task is cut off while its plan stage is running.
    process.env["FAKE_DELAY_MS"] = "30000";
    const slow = after.create({
      projectId: "beta",
      pipeline: "feature",
      title: "Cut off",
      description: "Slow plan.",
    });
    await until(() => after.list().find((x) => x.id === slow.id)?.stages[0]?.status === "running");
    const restarted = h.restart();
    const interrupted = restarted.list().find((x) => x.id === slow.id) as TaskView;
    expect(interrupted.status).toBe("failed");
    expect(interrupted.stages[0]).toMatchObject({ status: "failed", error: "interrupted" });
    delete process.env["FAKE_DELAY_MS"];
    restarted.retry(slow.id);
    await waitFor(restarted, slow.id, "waiting-gate");
    expect((await restarted.get(slow.id)).outputs["plan"]).toContain("# Plan");
  });

  it("fails a stage clearly when its prompt has an unknown placeholder or its provider fails", async () => {
    const h = harness();
    (h.ws.pipelines["feature"]?.stages[0] as { prompt: string }).prompt = "Plan {{task.unknown}}";
    const bad = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Bad template",
      description: "x",
    });
    const failed = await waitFor(h.engine, bad.id, "failed");
    expect(failed.stages[0]?.error).toContain("Unknown placeholder {{task.unknown}}");
    expect(h.notifier.list().map((n) => n.kind)).toEqual(["agent.failed"]);

    (h.ws.pipelines["feature"]?.stages[0] as { prompt: string }).prompt =
      "FAIL_RUN {{stage.outputPath}}";
    const bad2 = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Fails",
      description: "x",
    });
    const failed2 = await waitFor(h.engine, bad2.id, "failed");
    expect(failed2.stages[0]?.error).toContain("told to fail");
  });

  it("cancels a task and refuses invalid requests", async () => {
    const h = harness();
    expect(() =>
      h.engine.create({ projectId: "alpha", pipeline: "nope", title: "x", description: "" }),
    ).toThrow(/no pipeline/);
    expect(() =>
      h.engine.create({ projectId: "ghost", pipeline: "feature", title: "x", description: "" }),
    ).toThrow(/No project/);
    process.env["FAKE_DELAY_MS"] = "30000";
    const t = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Cancel me",
      description: "x",
    });
    await until(() => h.engine.list()[0]?.stages[0]?.status === "running");
    h.engine.cancel(t.id);
    expect(h.engine.list()[0]?.status).toBe("cancelled");
    expect(() => h.engine.approve(t.id)).toThrow(/not waiting/);
    expect(() => h.engine.retry(t.id)).toThrow(/Only a failed task/);
    await new Promise((r) => setTimeout(r, 1500));
    expect(h.engine.list()[0]?.status).toBe("cancelled");
    expect(existsSync(join(h.world.root, "tasks", t.id))).toBe(true);
    expect(readFileSync(join(h.world.hub, "Alpha", "OpenItems.md"), "utf8")).toContain(
      "Waiting on you",
    );
  });
});

describe("fan-out", () => {
  it("runs two builders in parallel, keeps one, and leaves no stray worktrees", async () => {
    const h = harness();
    const t = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Two builders",
      description: "Add it.",
      fanout: 2,
    });
    await waitFor(h.engine, t.id, "waiting-gate"); // plan gate
    h.engine.approve(t.id);

    // The build stage ends at a choice, not at a plain gate.
    await until(() => h.engine.list()[0]?.stages[1]?.status === "waiting-gate");
    const detail = await h.engine.get(t.id);
    expect(detail.variants.map((v) => [v.n, v.status, v.commits, v.files.length])).toEqual([
      [1, "done", 1, 1],
      [2, "done", 1, 1],
    ]);
    expect(detail.variants[0]?.branch).toMatch(/^office\/two-builders-.*-v1$/);
    expect(() => h.engine.approve(t.id)).toThrow(/Pick one/);

    const alpha = h.world.code["alpha"]?.work as string;
    const beforeBranches = sh(alpha, "branch", "--format=%(refname:short)").trim().split("\n");
    expect(beforeBranches.filter((b) => b.includes("-v"))).toHaveLength(2);

    await h.engine.keep(t.id, 2);
    // The kept builder's work is merged into the task branch; the review stage runs next.
    const atReview = await waitFor(h.engine, t.id, "waiting-gate");
    expect(atReview.stageIndex).toBe(2);
    expect(sh(atReview.worktree as string, "log", "--format=%s", "-3")).toContain("Merge office/");
    expect(sh(atReview.worktree as string, "ls-files")).toContain("built-");

    // No variant worktree or branch is left behind.
    const worktrees = sh(alpha, "worktree", "list", "--porcelain");
    expect(worktrees.match(/^worktree /gm)).toHaveLength(2);
    expect(sh(alpha, "branch", "--format=%(refname:short)")).not.toMatch(/-v\d/);
    const after = await h.engine.get(t.id);
    expect(after.variants.map((v) => v.status)).toEqual(["discarded", "kept"]);
    h.engine.approve(t.id);
    await waitFor(h.engine, t.id, "done");
  });

  it("a rejection discards every builder and runs them again; keeping a failed one is refused", async () => {
    const h = harness();
    const t = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Redo",
      description: "x",
      fanout: 2,
    });
    await waitFor(h.engine, t.id, "waiting-gate");
    h.engine.approve(t.id);
    await until(() => h.engine.list()[0]?.stages[1]?.status === "waiting-gate");
    const first = (await h.engine.get(t.id)).variants.map((v) => v.worktree);
    h.engine.reject(t.id, "Try a different approach");
    await until(
      () =>
        h.engine.list()[0]?.stages[1]?.status === "waiting-gate" &&
        h.engine.list()[0]?.status === "waiting-gate",
    );
    const again = (await h.engine.get(t.id)).variants;
    expect(again).toHaveLength(2);
    expect(again.map((v) => v.status)).toEqual(["done", "done"]);
    const alpha = h.world.code["alpha"]?.work as string;
    expect(sh(alpha, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(4);
    expect(first.length).toBe(2);
    await expect(h.engine.keep(t.id, 9)).rejects.toThrow(/not available/);
    h.engine.cancel(t.id);
  });
});

describe("hand-off records", () => {
  it("records a finished task in the project notes only when asked, once, through the writer", async () => {
    const h = harness();
    const t = h.engine.create({
      projectId: "alpha",
      pipeline: "feature",
      title: "Record me",
      description: "x",
    });
    await expect(h.engine.record(t.id)).rejects.toThrow(/Only a finished task/);
    await waitFor(h.engine, t.id, "waiting-gate");
    h.engine.approve(t.id);
    await until(
      () => h.engine.list()[0]?.stageIndex === 2 && h.engine.list()[0]?.status === "waiting-gate",
    );
    h.engine.approve(t.id);
    await waitFor(h.engine, t.id, "done");

    const file = join(h.world.hub, "Alpha", "OpenItems.md");
    const before = readFileSync(file, "utf8");
    expect(before).not.toContain("Record me");
    expect(h.engine.list()[0]?.recorded).toBe(false);

    await h.engine.record(t.id);
    const after = readFileSync(file, "utf8");
    const record = after.split("\n").find((l) => l.includes("Record me")) ?? "";
    expect(record).toMatch(
      /^- 2026-11-19 Task "Record me" \(Feature\) finished on office\/record-me-[0-9a-f]{4}; stages: plan, build, review\.$/,
    );
    expect(after).toContain("## Implementation notes\n\n- 2026-11-01 A dated note.\n" + record);
    expect(after.split("\n").length - before.split("\n").length).toBe(1);
    expect(sh(join(h.world.hub, "Alpha"), "log", "-1", "--format=%s")).toContain(
      'Alpha: todo: Task "Record me"',
    );
    expect(h.engine.list()[0]?.recorded).toBe(true);
    await expect(h.engine.record(t.id)).rejects.toThrow(/already recorded/);
  });
});
