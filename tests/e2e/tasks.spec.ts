import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("a Feature task runs plan, build and review with only the owner's approvals", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-board").click();
  await win.getByTestId("new-task-open").click();
  await win.getByTestId("task-project").selectOption({ label: "Alpha" });
  await win.getByTestId("task-title").fill("Add the sheep counter");
  await win.getByTestId("task-description").fill("Add a counter of sheep to the HUD.");
  await win.getByTestId("task-create").click();

  // The plan stage finishes and waits for the owner: the card is in "Waiting on you".
  const waiting = win.getByTestId("column-waiting");
  await expect(waiting.getByTestId("task-card")).toHaveCount(1, { timeout: 60000 });
  await expect(win.getByTestId("stage-output")).toContainText("Do the thing.");
  await win.getByTestId("task-approve").click();

  // Build runs in a new worktree; review then waits at the second gate with the diff visible.
  await expect(win.getByTestId("stage-tab").nth(2)).toHaveAttribute("data-status", "waiting-gate", {
    timeout: 90000,
  });
  await win.getByTestId("stage-tab").nth(2).click();
  await expect(win.getByTestId("stage-output")).toContainText("No problems found.");
  await expect(win.getByTestId("task-diff")).toContainText("built-");
  const worktrees = await win.evaluate(() =>
    window.office.invoke("worktrees.list", { projectId: "alpha" }),
  );
  expect(worktrees.filter((w) => w.kind === "office")).toHaveLength(1);

  await win.getByTestId("task-approve").click();
  await expect(win.getByTestId("column-done").getByTestId("task-card")).toHaveCount(1, {
    timeout: 60000,
  });
  await app.close();
});

test("rejecting a gate runs the stage again, and a failed task can be retried or cancelled", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-board").click();
  await win.getByTestId("new-task-open").click();
  await win.getByTestId("task-project").selectOption({ label: "Beta" });
  await win.getByTestId("task-title").fill("Rework me");
  await win.getByTestId("task-create").click();
  await expect(win.getByTestId("column-waiting").getByTestId("task-card")).toHaveCount(1, {
    timeout: 60000,
  });
  const firstRun = (await win.evaluate(() => window.office.invoke("tasks.list", {})))[0]?.stages[0]
    ?.runId;

  await win.getByTestId("task-reject-open").click();
  await win.getByTestId("reject-comment").fill("Cover the error cases");
  await win.getByTestId("task-reject").click();
  await expect
    .poll(
      async () =>
        (await win.evaluate(() => window.office.invoke("tasks.list", {})))[0]?.stages[0]?.runId,
      { timeout: 60000 },
    )
    .not.toBe(firstRun);
  await expect(win.getByTestId("column-waiting").getByTestId("task-card")).toHaveCount(1, {
    timeout: 60000,
  });

  await win.getByTestId("task-cancel").click();
  await expect(win.getByTestId("column-failed").getByTestId("task-card")).toHaveCount(1);
  await app.close();
});

test("fan-out: two builders run side by side, one is kept after a confirm, and no worktrees are left over", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-board").click();
  await win.getByTestId("new-task-open").click();
  await win.getByTestId("task-project").selectOption({ label: "Alpha" });
  await win.getByTestId("task-title").fill("Two builders");
  await win.getByTestId("task-fanout").selectOption("2");
  await win.getByTestId("task-create").click();
  await expect(win.getByTestId("column-waiting").getByTestId("task-card")).toHaveCount(1, {
    timeout: 60000,
  });
  await win.getByTestId("task-approve").click();

  // The build stage ends at a choice between the two results.
  await expect(win.getByTestId("variant")).toHaveCount(2, { timeout: 90000 });
  await expect(win.getByTestId("variant").first()).toHaveAttribute("data-status", "done", {
    timeout: 90000,
  });
  await expect(win.getByTestId("variant").nth(1)).toHaveAttribute("data-status", "done", {
    timeout: 90000,
  });
  await expect(win.getByTestId("variant-checks").first()).toContainText("1 commit(s), 1 file(s)");

  await win.getByTestId("keep-variant").first().click();
  await expect(win.getByTestId("keep-confirm")).toContainText(
    "removes the other builders' worktrees",
  );
  await win.getByTestId("keep-yes").click();

  // The review stage runs on the merged task branch; only the task's own worktree remains.
  await expect(win.getByTestId("stage-tab").nth(2)).toHaveAttribute("data-status", "waiting-gate", {
    timeout: 90000,
  });
  const worktrees = await win.evaluate(() =>
    window.office.invoke("worktrees.list", { projectId: "alpha" }),
  );
  expect(worktrees.filter((w) => w.kind === "office")).toHaveLength(1);
  await app.close();
});
