import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/main/core/db";
import type { Notifier } from "../../src/main/core/notifier";
import { WorkspaceStore } from "../../src/main/core/workspace";
import { Scheduler } from "../../src/main/core/scheduler";
import type { RunService } from "../../src/main/modules/runs/service";
import { WorkspaceEditor } from "../../src/main/modules/tasks/editor";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import { claudeTaskViews, readClaudeTasks, workflowFromClaudeTask } from "../../src/main/modules/workflows/claude-tasks";
import { workflowsFor } from "../../src/shared/workflow";
import { tmp } from "../fixtures/repos/make";
import { makeWorld } from "../fixtures/vault/make";

let home: string;
let appData: string;
beforeEach(() => {
  home = tmp("office-claude-home-");
  appData = tmp("office-claude-appdata-");
  const skills: Array<[string, string, string]> = [
    ["funding-watch", "Funding watch", "Weekly scan for grants, logged in the Brain"],
    ["blog-drafts", "Blog drafts", "Every Tuesday: three blog drafts"],
    ["letters", "Letters", "Fallback drafts"],
  ];
  for (const [id, name, description] of skills) {
    mkdirSync(join(home, ".claude", "scheduled-tasks", id), { recursive: true });
    writeFileSync(join(home, ".claude", "scheduled-tasks", id, "SKILL.md"),
      `---\nname: ${id}\ndescription: ${description}\n---\n\nYou are the ${name} run.\nRead the Brain notes and record what changed.\n`);
  }
  const state = join(appData, "Claude", "claude-code-sessions", "account-1", "org-1");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "scheduled-tasks.json"), JSON.stringify({
    scheduledTasks: [
      { id: "funding-watch", displayName: "Funding watch (weekly)", cronExpression: "0 9 * * 1", enabled: true, cwd: "E:\\Projects\\Alpha" },
      { id: "blog-drafts", displayName: "Blog drafts (weekly)", cronExpression: "0 9 * * 2", enabled: true, cwd: "E:\\Projects\\Alpha" },
      { id: "letters", displayName: "Letters", cronExpression: "0 9 * * 1", enabled: false, cwd: "E:\\Projects\\Site" },
    ],
  }));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(appData, { recursive: true, force: true });
});

/** Every file under the folders with its content hash and modified time. */
function snapshot(...folders: string[]): string {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) { lines.push(`${path}/ ${stat.mtimeMs}`); walk(path); }
      else lines.push(`${path} ${stat.mtimeMs} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
    }
  };
  folders.forEach(walk);
  return lines.join("\n");
}

describe("Claude Code's scheduled tasks", () => {
  it("reads each task's prompt from SKILL.md and its schedule and state from the app", () => {
    const tasks = readClaudeTasks(join(home, ".claude"), appData);
    expect(tasks.map((task) => task.id)).toEqual(["blog-drafts", "funding-watch", "letters"]);
    expect(tasks[1]).toMatchObject({
      name: "Funding watch (weekly)", description: "Weekly scan for grants, logged in the Brain",
      schedule: "0 9 * * 1", enabled: true, cwd: "E:\\Projects\\Alpha",
    });
    expect(tasks[1]?.prompt).toBe("You are the Funding watch run.\nRead the Brain notes and record what changed.");
    expect(tasks[2]?.enabled).toBe(false);
  });

  it("reports an unknown schedule when the app state is missing, so the Move dialog can ask", () => {
    const tasks = readClaudeTasks(join(home, ".claude"), join(appData, "nowhere"));
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.schedule === null && task.enabled === null)).toBe(true);
    expect(tasks[0]?.name).toBe("blog-drafts");
    expect(readClaudeTasks(join(home, "no-claude"), appData)).toEqual([]);
  });

  it("moving a task never writes to the Claude folders: they are identical afterwards", async () => {
    const before = snapshot(join(home, ".claude"), appData);
    const world = makeWorld();
    const store = new WorkspaceStore();
    await store.open(world.hub, world.workspaceConfigPath);
    const editor = new WorkspaceEditor({
      writer: new VaultWriter({ hubRoot: () => world.hub, onWarning: () => undefined }),
      workspaceFile: () => store.filePath,
      reload: () => void store.reload(),
      adopt: (workspace) => store.adopt(workspace),
    });
    const [task] = readClaudeTasks(join(home, ".claude"), appData).filter((entry) => entry.id === "funding-watch");
    const workflow = workflowFromClaudeTask(task!, { taken: new Set(workflowsFor(store.state.workspace).map((entry) => entry.id)) });
    await editor.saveWorkflow(workflow, { absent: true });
    const saved = workflowsFor(store.state.workspace).find((entry) => entry.fromClaudeTask === "funding-watch");
    expect(saved).toMatchObject({
      name: "Funding watch (weekly)", schedule: "0 9 * * 1", mayDo: "brain", web: true, enabled: false,
      prompt: "You are the Funding watch run.\nRead the Brain notes and record what changed.",
    });
    expect(snapshot(join(home, ".claude"), appData)).toBe(before);
    // A second move is a new id, never an overwrite.
    expect(workflowFromClaudeTask(task!, { taken: new Set(["funding-watch"]) }).id).toBe("funding-watch-2");
    await store.close();
  });

  it("the module has no way to write: it imports only reading functions of the file system", () => {
    const source = readFileSync(join(__dirname, "../../src/main/modules/workflows/claude-tasks.ts"), "utf8");
    const fs = [...source.matchAll(/import \{([^}]*)\} from "node:fs(?:\/promises)?"/g)].flatMap((match) => (match[1] ?? "").split(",").map((name) => name.trim()));
    expect(fs.sort()).toEqual(["readFileSync", "readdirSync", "statSync"]);
    expect(source).not.toMatch(/writeFile|appendFile|unlink|rmSync|rename|copyFile|mkdir|spawn|exec\(/);
  });

  it("warns on both sides while a task and its workflow are on, and says nothing once the task is off", () => {
    const tasks = readClaudeTasks(join(home, ".claude"), appData);
    const task = tasks.find((entry) => entry.id === "funding-watch")!;
    const workflow = { ...workflowFromClaudeTask(task, { taken: new Set() }), enabled: true };
    const workspace = { vault: { kind: "folder" }, projects: [], workflows: [workflow], automations: [], roles: {} } as never;
    const views = claudeTaskViews(tasks, workspace, () => undefined);
    expect(views.find((view) => view.id === "funding-watch")).toMatchObject({ movedAs: { id: workflow.id, enabled: true }, runsTwice: true });
    expect(views.find((view) => view.id === "blog-drafts")).toMatchObject({ movedAs: null, runsTwice: false });
    const off = claudeTaskViews(tasks.map((entry) => ({ ...entry, enabled: false })), workspace, () => undefined);
    expect(off.every((view) => !view.runsTwice)).toBe(true);

    const db = openDb(":memory:");
    const scheduler = (claude: boolean) => new Scheduler({
      db, notifier: { notify: vi.fn() } as unknown as Notifier, root: () => "root", neutralFolder: () => "root",
      defaultProvider: () => "fake", projectPath: () => undefined, workspace: () => workspace,
      runs: {} as unknown as RunService, output: async () => undefined,
      claudeTasks: () => [{ id: "funding-watch", name: "Funding watch (weekly)", enabled: claude }],
    });
    expect(scheduler(true).list()[0]?.alsoRunsIn).toBe("Funding watch (weekly)");
    expect(scheduler(false).list()[0]?.alsoRunsIn).toBeNull();
    db.close();
  });
});
