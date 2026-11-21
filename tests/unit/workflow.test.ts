import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/main/core/db";
import type { Notifier } from "../../src/main/core/notifier";
import { Scheduler, workflowRequest } from "../../src/main/core/scheduler";
import { BriefService } from "../../src/main/modules/brief/brief";
import type { RunService } from "../../src/main/modules/runs/service";
import { WorkflowResults } from "../../src/main/modules/runs/workflow-results";
import { Workspace } from "../../src/shared/schemas";
import { Workflow, workflowsFor } from "../../src/shared/workflow";
import { tmp, write } from "../fixtures/repos/make";

let root: string;
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  root = tmp("office-workflow-");
  db = openDb(join(root, "office.db"));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const project = { id: "alpha", name: "Alpha", path: "Code", vault: "Projects/Alpha" };
const config = {
  version: 1, vault: { kind: "folder" }, projects: [project, { ...project, id: "secret", vault: "Projects/Secret" }],
  roles: {}, pipelines: {}, notifications: { urgent: [] },
};
const workflow = Workflow.parse({
  id: "ideas", name: "Ideas", schedule: "* * * * *", projectId: "alpha", prompt: "Find opportunities", read: "brain",
});

describe("workflow migration and safety", () => {
  it("keeps the project, schedule, prompt and model of a legacy automation", () => {
    const ws = Workspace.parse({
      ...config, roles: { researcher: { provider: "codex", model: "configured-model" } },
      automations: [{ id: "daily", cron: "0 8 * * *", project: "alpha", role: "researcher", prompt: "Read the notes", enabled: false }],
    });
    expect(workflowsFor(ws)).toMatchObject([{
      id: "daily", schedule: "0 8 * * *", projectId: "alpha", provider: "codex",
      model: "configured-model", prompt: "Read the notes", enabled: false,
    }]);
  });

  it("uses read-only provider options and withholds private notes and project files from Brain-only runs", () => {
    write(root, "Projects/Secret/brain.json", '{"private":true}');
    const options = workflowRequest(workflow, Workspace.parse(config), root, join(root, "Code"), root, "codex");
    expect(options.cwd).toBe(root);
    expect(options.role?.readOnly).toBe(true);
    expect(options.brain?.writable).toEqual([]);
    expect(options.brain?.private).toContain(join(root, "Projects/Secret"));
    expect(options.brain?.restrictedRead).toBe(true);
    expect(options.addDirs).toBeUndefined();
    expect(workflowRequest({ ...workflow, read: "none" }, Workspace.parse(config), root, join(root, "Code"), root, "codex").tools).toBe("");
  });

  it("skips scheduled slots while off and stores bounded results in the correct workspace", async () => {
    let time = new Date("2026-11-21T09:00:00Z");
    let active = false;
    const result = Promise.resolve({ ok: true, resultText: JSON.stringify({
      items: Array.from({ length: 5 }, (_, i) => ({
        title: `Idea ${i}`, why: "A fixture improvement", projectIds: ["alpha"],
        sources: ["Projects/Alpha/Overview.md"], firstStep: "Review the overview",
      })),
    }) });
    const start = vi.fn(() => ({ id: "fixture-run", result }));
    const notifier = { notify: vi.fn() } as unknown as Notifier;
    const outputs = new WorkflowResults({ db, root: () => root, changed: vi.fn(), saveNote: vi.fn() });
    const scheduler = new Scheduler({
      db, notifier, root: () => root, neutralFolder: () => root, defaultProvider: () => "fake",
      projectPath: () => join(root, "Code"),
      workspace: () => Workspace.parse({ ...config, workflows: [{ ...workflow, enabled: active }] }),
      runs: { start } as unknown as RunService,
      output: (scope, item, text) => outputs.save(scope, item, text),
      now: () => time,
    });
    scheduler.tick();
    time = new Date("2026-11-21T09:03:00Z");
    scheduler.tick();
    active = true;
    scheduler.tick();
    expect(start).not.toHaveBeenCalled();
    await scheduler.fire("ideas");
    const ideas = outputs.list();
    expect(ideas).toHaveLength(5);
    expect(ideas[0]?.projectIds).toEqual(["alpha"]);
    outputs.dismiss(ideas[0]!.id);
    expect(outputs.list()).toHaveLength(4);
  });

  it("gathers and shows facts with the morning brief switched off", async () => {
    const projectEntry = Workspace.parse(config).projects[0]!;
    const start = vi.fn();
    const brief = new BriefService({
      db, runs: { start } as unknown as RunService,
      notifier: {} as Notifier, workspace: () => Workspace.parse(config),
      projectsRoot: () => root, workspaceRoot: () => root,
      settings: () => ({ enabled: false, model: "" }),
    });
    vi.spyOn(brief, "collect").mockResolvedValue([{ project: projectEntry, commits: ["A change"], notes: [], sessions: [], runs: [] }]);
    await brief.run();
    expect(start).not.toHaveBeenCalled();
    expect(brief.latest().lines[0]?.text).toContain("Alpha");
    expect(brief.latest().items[0]?.markdown).toContain("A change");
  });
});
