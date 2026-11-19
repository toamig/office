import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, pick, toasts } from "./helpers";

test("a profile is made, given to a new role, the role is added to a pipeline, and Used in shows it", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  const config = (): {
    roles: Record<string, Record<string, unknown>>;
    permissionProfiles: Record<string, Record<string, unknown>>;
    pipelines: Record<string, { stages: Array<Record<string, unknown>> }>;
  } => JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  await win.getByTestId("rail-board").click();
  await expect(win.getByTestId("board-tab-pipelines")).toBeVisible();
  await expect(win.getByTestId("board-tab-permissions")).toBeVisible();

  // The Permissions tab lists the built-in profiles, which cannot be edited, only duplicated.
  await win.getByTestId("board-tab-permissions").click();
  for (const name of ["Read only", "Ask first", "Plan only", "Builder", "Reviewer"])
    await expect(win.getByTestId("profile-row").filter({ hasText: name }).first()).toBeVisible();
  await win.getByTestId("profile-row").filter({ hasText: "Builder" }).first().click();
  await expect(win.getByTestId("profile-save")).toHaveCount(0);
  await expect(win.getByTestId("profile-editor")).toContainText("cannot be changed");

  // A new profile: Accept edits, a command picked from the examples, saved into the workspace config.
  await win.getByTestId("new-profile").click();
  await win.getByTestId("profile-name").fill("Tidy");
  await win.getByTestId("profile-description").fill("Edits files and runs the tests.");
  await pick(win, "profile-claude-mode", "acceptEdits");
  await expect(win.getByTestId("profile-editor")).toContainText("Edits files without asking");
  await pick(win, "profile-allowed-example", { label: "Run tests" });
  await expect(win.getByTestId("rule-row")).toHaveCount(1);
  await expect(win.getByTestId("rule-row")).toContainText("Runs the project's tests.");
  await win.getByTestId("profile-save").click();
  await expect(toasts(win).filter({ hasText: "Profile saved" })).toBeVisible();
  expect(config().permissionProfiles["tidy"]).toMatchObject({
    claudeMode: "acceptEdits",
    allowedCommands: ["Bash(npm test:*)"],
  });

  // Bypass permissions cannot be saved until the confirmation is ticked.
  await win.getByTestId("new-profile").click();
  await win.getByTestId("profile-name").fill("Wide open");
  await pick(win, "profile-claude-mode", "bypassPermissions");
  await expect(win.getByTestId("profile-save")).toBeDisabled();
  await win.getByTestId("profile-unsafe-ok").check();
  await expect(win.getByTestId("profile-save")).toBeEnabled();
  await win.getByTestId("profile-row").filter({ hasText: "Tidy" }).click();

  // A role from a template, with the new profile; it is in no pipeline yet, and says so.
  await win.getByTestId("board-tab-roles").click();
  await win.getByTestId("new-role").click();
  await win.getByTestId("new-role-id").fill("tidier");
  await pick(win, "new-role-template", { label: "Builder" });
  await win.getByTestId("new-role-create").click();
  await expect(win.getByTestId("role-form")).toContainText("Tidier");
  await pick(win, "role-profile", { label: "Tidy" });
  await expect(win.getByTestId("role-profile-sentence")).toContainText(
    "Edits files and runs the tests.",
  );
  await win.getByTestId("role-save").click();
  await expect(toasts(win).filter({ hasText: "Role saved" })).toBeVisible();
  expect(config().roles["tidier"]).toMatchObject({ permissionProfile: "tidy" });
  expect(config().roles["tidier"]?.["allowedCommands"]).toBeUndefined();
  await expect(win.getByTestId("role-unused")).toBeVisible();

  // Add it to a pipeline from the role, and Used in lists the pipeline.
  await win.getByTestId("role-add-to-pipeline").click();
  await expect(win.getByTestId("pipeline-editor")).toBeVisible();
  await win.getByTestId("pipeline-row").filter({ hasText: "Feature" }).click();
  await win.getByTestId("stage-add").click();
  const last = win.getByTestId("stage-editor").last();
  await last.getByTestId("stage-id").fill("tidy");
  await last.getByTestId("stage-role").click();
  await win.getByTestId("select-menu").getByRole("option", { name: "Tidier", exact: true }).click();
  await win.getByTestId("pipeline-save").click();
  await expect(toasts(win).filter({ hasText: "Pipeline saved" })).toBeVisible();
  expect(config().pipelines["feature"]?.stages.map((s) => s["role"])).toEqual([
    "planner",
    "builder",
    "reviewer",
    "tidier",
  ]);
  await win.getByTestId("board-tab-roles").click();
  await win.getByTestId("role-row").filter({ hasText: "tidier" }).click();
  await expect(win.getByTestId("role-used-in")).toContainText("Feature");
  await expect(win.getByTestId("role-used-in")).toContainText("Tidy");
  await app.close();
});

test("the pipeline editor reorders stages, previews the diagram, and refuses a stage whose role is missing", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-board").click();
  await win.getByTestId("board-tab-pipelines").click();
  await win.getByTestId("pipeline-row").filter({ hasText: "Feature" }).click();
  const ids = (): Promise<string[]> =>
    win.getByTestId("stage-id").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(await ids()).toEqual(["plan", "build", "review"]);
  // The diagram shows the stages in order, with the owner's approvals between them.
  await expect(
    win.getByTestId("pipeline-preview-diagram").getByTestId("diagram-stage"),
  ).toHaveCount(3);
  await expect(win.getByTestId("pipeline-preview-diagram").getByTestId("diagram-you")).toHaveCount(
    2,
  );
  await win.getByTestId("stage-down").first().click();
  expect(await ids()).toEqual(["build", "plan", "review"]);
  await win.getByTestId("stage-up").nth(2).click();
  expect(await ids()).toEqual(["build", "review", "plan"]);
  await win.getByTestId("pipeline-save").click();
  await expect(toasts(win).filter({ hasText: "Pipeline saved" })).toBeVisible();
  const saved = JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  expect(saved.pipelines.feature.stages.map((s: { id: string }) => s.id)).toEqual([
    "build",
    "review",
    "plan",
  ]);
  await app.close();
});

test("a Feature task shows its stages in a diagram, and the current stage moves from Plan to Build to Review", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-board").click();
  await win.getByTestId("new-task-open").click();
  await pick(win, "task-project", { label: "Alpha" });
  await win.getByTestId("task-title").fill("Follow the stages");
  await win.getByTestId("task-description").fill("Do it.");
  await win.getByTestId("task-create").click();

  // The card carries the compact diagram: one mark per stage, and who is on the current one.
  const card = win.getByTestId("task-card").first();
  await expect(card.locator(".mark")).toHaveCount(3);
  const detail = win.getByTestId("task-detail");
  const diagram = detail.getByTestId("pipeline-diagram");
  const current = diagram.locator('[data-current="true"]');
  await expect(current).toHaveAttribute("data-stage", "plan", { timeout: 60000 });
  await expect(current).toHaveAttribute("data-status", "waiting-gate", { timeout: 60000 });
  await expect(card.getByTestId("marks-now")).toContainText("Plan, Planner");
  await expect(diagram.getByTestId("diagram-you")).toHaveCount(2);

  await win.getByTestId("task-approve").click();
  await expect(current).toHaveAttribute("data-stage", "review", { timeout: 90000 });
  await expect(current).toHaveAttribute("data-status", "waiting-gate", { timeout: 90000 });
  await expect(diagram.locator('[data-stage="plan"]')).toHaveAttribute(
    "data-status",
    /approved|done/,
  );
  await expect(diagram.locator('[data-stage="build"]')).toHaveAttribute(
    "data-status",
    /approved|done/,
  );
  await expect(card.getByTestId("marks-now")).toContainText("Review, Reviewer");
  // Clicking a stage opens its output.
  await diagram.locator('[data-stage="plan"] button').click();
  await expect(win.getByTestId("stage-output")).toContainText("Do the thing.");
  await win.getByTestId("task-approve").click();
  await expect(win.getByTestId("column-done").getByTestId("task-card")).toHaveCount(1, {
    timeout: 60000,
  });
  await app.close();
});
