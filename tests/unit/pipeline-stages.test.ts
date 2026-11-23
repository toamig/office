import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import type { Notifier } from "../../src/main/core/notifier";
import type { RunRequest, RunService } from "../../src/main/modules/runs/service";
import { TaskEngine } from "../../src/main/modules/tasks/engine";
import { draftPrompt, parseDraft } from "../../src/main/modules/tasks/pipeline-draft";
import { PIPELINE_TEMPLATES, STAGE_PRESETS, idFromName, roleFor } from "../../src/shared/pipeline-presets";
import {
  INLINE_RESULT_LIMIT, buildStagePrompt, samplePrompt, unknownVariables, variableLabel, variablesFor,
  type StageContext, type StageLike,
} from "../../src/shared/pipeline-prompt";
import { Workspace } from "../../src/shared/schemas";
import { tmp } from "../fixtures/repos/make";

let root: string;
beforeEach(() => { root = tmp("office-pipeline-stages-"); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const task = { id: "t1", title: "Add dark mode", description: "Add a theme switch.", project: "Alpha", projectId: "alpha", branch: null, worktree: null };
const context = (earlier: StageContext["earlier"]): StageContext => ({ task, outputPath: (id) => `/tasks/t1/${id}.md`, earlier });

describe("what a stage receives", () => {
  it("gets the task and the result of each earlier stage it includes, nothing else", () => {
    const stage: StageLike = { id: "review", prompt: "Review the change.", exclude: ["plan"] };
    const earlier = [
      { id: "plan", name: "Plan", text: "PLAN: do three things", path: "/tasks/t1/plan.md" },
      { id: "build", name: "Build", text: "BUILD: done in two commits", path: "/tasks/t1/build.md" },
    ];
    const prompt = buildStagePrompt(stage, context(earlier));
    expect(prompt.startsWith("Review the change.\n\n## What you have")).toBe(true);
    expect(prompt).toContain("Task: Add dark mode");
    expect(prompt).toContain("Description: Add a theme switch.");
    expect(prompt).toContain("### Result of the Build stage\nBUILD: done in two commits");
    expect(prompt).not.toContain("PLAN: do three things");
    expect(prompt).not.toContain("Result of the Plan stage");
    // With nothing left out, both arrive, in order.
    const both = buildStagePrompt({ ...stage, exclude: [] }, context(earlier));
    expect(both.indexOf("PLAN: do three things")).toBeGreaterThan(0);
    expect(both.indexOf("PLAN: do three things")).toBeLessThan(both.indexOf("BUILD: done in two commits"));
  });

  it("puts a short result in the prompt and points to the file for a long one, and says when there is none", () => {
    const long = "x".repeat(INLINE_RESULT_LIMIT + 1);
    const prompt = buildStagePrompt({ id: "test", prompt: "Test it." }, context([
      { id: "plan", name: "Plan", text: long, path: "/tasks/t1/plan.md" },
      { id: "build", name: "Build", text: null, path: "/tasks/t1/build.md" },
    ]));
    expect(prompt).not.toContain(long);
    expect(prompt).toContain("It is long. Read it in /tasks/t1/plan.md");
    expect(prompt).toContain("### Result of the Build stage\nIt produced no result.");
  });

  it("keeps the old {{ }} variables working, including the path of a stage that has not run yet", () => {
    const prompt = buildStagePrompt(
      { id: "build", prompt: "Plan is in {{stages.plan.outputPath}}, write to {{stage.outputPath}}, then {{stages.review.outputPath}} for {{task.project}}." },
      context([{ id: "plan", name: "Plan", text: "p", path: "/tasks/t1/plan.md" }]),
    );
    expect(prompt).toContain("Plan is in /tasks/t1/plan.md, write to /tasks/t1/build.md, then /tasks/t1/review.md for alpha.");
    expect(() => buildStagePrompt({ id: "build", prompt: "{{task.branch}}" }, context([]))).toThrow(/task.branch/);
    expect(() => buildStagePrompt({ id: "build", prompt: "{{nonsense.thing}}" }, context([]))).toThrow(/nonsense.thing/);
  });

  it("names the variables in plain words and marks an unknown one", () => {
    const stages: StageLike[] = [{ id: "plan", name: "Plan", prompt: "" }, { id: "build", prompt: "" }];
    const options = variablesFor(stages, 1);
    expect(options.map((option) => option.label)).toContain("Task description");
    expect(options.map((option) => option.label)).toContain("Plan stage result file");
    expect(options.map((option) => option.key)).not.toContain("stages.build.outputPath");
    expect(variableLabel("task.worktree", stages, 1)).toBe("Worktree folder");
    expect(unknownVariables("{{task.title}} {{stages.plan.outputPath}} {{task.titel}} {{stages.gone.outputPath}}", stages)).toEqual(["task.titel", "stages.gone.outputPath"]);
  });
});

describe("the preview equals what the engine sends", () => {
  function engineFor() {
    const db = openDb(":memory:");
    const workspace = Workspace.parse({
      version: 1, vault: { kind: "none" }, projects: [{ id: "alpha", name: "Alpha", path: "alpha" }],
      roles: { worker: { provider: "fake" } }, notifications: { urgent: [] },
      pipelines: {
        flow: {
          name: "Flow",
          stages: [
            { id: "plan", name: "Plan", role: "worker", prompt: "Plan {{task.title}}." },
            { id: "build", role: "worker", prompt: "Build it. Plan: {{stages.plan.outputPath}}" },
            { id: "review", role: "worker", exclude: ["plan"], prompt: "Review {{task.title}}." },
          ],
        },
      },
    });
    const sent: Array<{ stage: string; prompt: string }> = [];
    const later: { engine?: TaskEngine } = {};
    const answers: Record<string, string> = { plan: "PLAN RESULT", build: "BUILD RESULT", review: "REVIEW RESULT" };
    const runs = {
      start: vi.fn((request: RunRequest) => {
        const stage = /^Add dark mode: (\w+)$/.exec(request.title ?? "")?.[1] ?? "?";
        const idx = ["plan", "build", "review"].indexOf(stage);
        // At the moment the stage starts, the preview must already say exactly what it is about to be sent.
        sent.push({ stage, prompt: request.prompt });
        const { id: taskId } = db.prepare("SELECT id FROM tasks").get() as { id: string };
        expect(later.engine?.stagePrompt(taskId, idx)).toBe(request.prompt);
        return { id: `run-${stage}`, dir: root, result: Promise.resolve({ ok: true, resultText: answers[stage] ?? "", id: `run-${stage}` }) };
      }),
      cancel: vi.fn(),
    } as unknown as RunService;
    const engine = new TaskEngine({
      db, bus: new Bus(), runs, notifier: { notify: vi.fn() } as unknown as Notifier, workspace: () => workspace,
      projectPath: () => join(root, "alpha"), resolveRole: () => ({ provider: "fake", instructions: "", readOnly: false, allowedCommands: [] }),
      tasksDir: join(root, "tasks"), artVaultRoot: () => "", recordNote: async () => undefined,
    });
    later.engine = engine;
    return { engine, sent, db };
  }

  it("a stage gets exactly the earlier results that are included, and the preview shows the same text", async () => {
    const { engine, sent, db } = engineFor();
    engine.create({ projectId: "alpha", pipeline: "flow", title: "Add dark mode", description: "Add a theme switch." });
    await vi.waitFor(() => expect(engine.list()[0]?.status).toBe("done"), { timeout: 10_000 });
    expect(sent.map((entry) => entry.stage)).toEqual(["plan", "build", "review"]);
    const build = sent[1]!.prompt;
    expect(build).toContain("Plan: ");
    expect(build).toContain("### Result of the Plan stage\nPLAN RESULT");
    const review = sent[2]!.prompt;
    expect(review).toContain("### Result of the Build stage\nBUILD RESULT");
    expect(review).not.toContain("PLAN RESULT");
    expect(review).not.toContain("Result of the Plan stage");
    db.close();
  });

  it("the draft preview of a pipeline being edited uses the same function with made-up facts", () => {
    const stages = [
      { id: "plan", name: "Plan", prompt: "Plan it.", worktree: false },
      { id: "build", prompt: "Build it.", worktree: true, exclude: ["plan"] },
    ];
    const first = samplePrompt(stages, 0);
    expect(first).toContain("Task: Add a dark mode");
    expect(first).not.toContain("Branch:");
    const second = samplePrompt(stages, 1);
    expect(second).toContain("Branch: office/add-a-dark-mode");
    expect(second).not.toContain("Result of the Plan stage");
    expect(samplePrompt([{ id: "a", prompt: "A", exclude: [] }, { id: "b", prompt: "B" }], 1)).toContain("### Result of the A stage");
  });
});

describe("presets, templates and the drafted pipeline", () => {
  it("derives a stage id from its name once and keeps ids unique", () => {
    expect(idFromName("Plan the work", [])).toBe("plan-the-work");
    expect(idFromName("Plan", ["plan", "plan-2"])).toBe("plan-3");
    expect(idFromName("???", [])).toBe("stage");
    expect(roleFor("review", { builder: {}, "code-reviewer": {} })).toBe("code-reviewer");
    expect(roleFor("nothing", { first: {}, second: {} })).toBe("first");
    expect(STAGE_PRESETS.map((preset) => preset.name)).toEqual(["Plan", "Build", "Review", "Test", "Document"]);
    expect(PIPELINE_TEMPLATES[0]).toEqual({ name: "Plan, build, review", stages: ["Plan", "Build", "Review"] });
    for (const template of PIPELINE_TEMPLATES) for (const name of template.stages) expect(STAGE_PRESETS.some((preset) => preset.name === name)).toBe(true);
  });

  it("reads the model's reply into a pipeline, replaces roles that do not exist and ignores talk around the JSON", () => {
    const roles = { planner: { purpose: "Plans work" }, builder: {}, reviewer: {} };
    const reply = 'Here is the pipeline:\n```json\n{"name":"Plan, build, review","stages":[{"name":"Plan","role":"Planner","gate":false,"prompt":"Plan it."},{"name":"Build","role":"coder","worktree":true,"prompt":"Build it."},{"name":"Build","role":"reviewer","gate":true,"prompt":"Check it."}]}\n```';
    const pipeline = parseDraft(reply, roles);
    expect(pipeline.name).toBe("Plan, build, review");
    expect(pipeline.stages.map((stage) => [stage.id, stage.role, stage.gate, stage.worktree])).toEqual([
      ["plan", "planner", false, false], ["build", "builder", false, true], ["build-2", "reviewer", true, false],
    ]);
    expect(pipeline.stages.every((stage) => stage.exclude.length === 0)).toBe(true);
    expect(() => parseDraft("no json here", roles)).toThrow();
    expect(draftPrompt("plan then build", roles)).toContain("planner (Plans work), builder, reviewer");
  });
});
