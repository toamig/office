import { expect, test, type Page } from "@playwright/test";
import { launch } from "./helpers";

const VIEWS = ["agents", "git", "board", "inbox"] as const;

const inspectorOpen = (win: Page): Promise<boolean> =>
  win.getByTestId("inspector").evaluate((el) => !(el as HTMLElement).hidden);

test("every view with an inspector opens and hides it from the top bar, and the other views have none", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Level work",
    }),
  );

  // Home, Projects, Brain, Explore and Setup keep one fixed layout: no inspector, no button.
  for (const view of ["home", "projects", "brain", "explore", "setup"]) {
    await win.getByTestId(`rail-${view}`).click();
    await expect(win.getByTestId("inspector-toggle")).toHaveCount(0);
    await expect(win.getByTestId("inspector")).toBeHidden();
  }

  for (const view of [...VIEWS, "project"] as const) {
    if (view === "project") {
      await win.getByTestId("rail-projects").click();
      await win.getByTestId("project-card").first().click();
    } else {
      await win.getByTestId(`rail-${view}`).click();
    }
    await expect(win.getByTestId("inspector-toggle"), view).toBeVisible();
    await expect(win.getByTestId("inspector"), `${view} shows it`).toBeVisible();
    await win.getByTestId("inspector-toggle").click();
    await expect(win.getByTestId("inspector"), `${view} hides it`).toBeHidden();
    await win.getByTestId("inspector-toggle").click();
    await expect(win.getByTestId("inspector")).toBeVisible();
  }
  await app.close();
});

test("each view puts its details in the inspector", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Level work",
    }),
  );
  await win.evaluate(() =>
    window.office.invoke("tasks.create", {
      projectId: "alpha",
      pipeline: "feature",
      title: "Add a sheep counter",
      description: "Plan it.",
      fanout: 1,
    }),
  );
  const body = win.getByTestId("inspector-body");

  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Level work" }).click();
  await expect(body.getByTestId("agent-inspector")).toContainText("Level work");
  await expect(body.getByTestId("agent-inspector")).toContainText("Alpha");
  await expect(body.getByTestId("agent-inspector")).toContainText("Permissions");
  await expect(body.getByTestId("agent-waiting")).toBeVisible();
  await expect(body.getByTestId("agent-files")).toBeVisible();
  expect(session.id).toBeTruthy();

  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).click();
  await expect(body.getByTestId("inspector-waiting")).toContainText(
    "Decide the sheep and enemy balance",
  );
  await expect(body.getByTestId("panel-runs")).toBeVisible();
  await expect(body.getByTestId("panel-prs")).toBeVisible();
  await expect(body.getByTestId("inspector-note")).toBeVisible();

  await win.getByTestId("rail-board").click();
  await expect(body.getByTestId("task-inspector")).toContainText("Pick a task");
  await win.getByTestId("task-card").filter({ hasText: "Add a sheep counter" }).click();
  await expect(body.getByTestId("inspector-diagram").getByTestId("diagram-stage")).toHaveCount(3);
  await expect(body.getByTestId("task-inspector")).toContainText("Add a sheep counter");

  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  await expect(body.getByTestId("git-inspector")).toContainText("Last commit");
  await expect(body.getByTestId("git-inspector")).toContainText("main");

  await win.getByTestId("rail-inbox").click();
  await expect(body.getByTestId("inbox-detail")).toContainText("Pick an item");
  await win.getByTestId("pending-item").first().click();
  await expect(body.getByTestId("inbox-detail")).not.toContainText("Pick an item");
  await app.close();
});

test("Ctrl+Shift+B toggles the inspector, from the page and from a terminal", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Level work",
      mode: "terminal",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Level work" }).click();
  await expect(win.locator('[data-testid="terminal"]')).toBeVisible();
  expect(await inspectorOpen(win)).toBe(true);

  // From the page.
  await win.getByTestId("rail-agents").focus();
  await win.keyboard.press("Control+Shift+B");
  await expect.poll(() => inspectorOpen(win)).toBe(false);
  await win.keyboard.press("Control+Shift+B");
  await expect.poll(() => inspectorOpen(win)).toBe(true);

  // From inside the terminal, where Ctrl+B belongs to the program but Ctrl+Shift+B is Office's.
  await win.locator(".xterm").click();
  await win.keyboard.press("Control+Shift+B");
  await expect.poll(() => inspectorOpen(win)).toBe(false);
  await win.keyboard.press("Control+Shift+B");
  await expect.poll(() => inspectorOpen(win)).toBe(true);
  // The sidebar's own key still goes to the program there.
  const sidebar = win.getByTestId("rail");
  const before = (await sidebar.boundingBox())?.width;
  await win.keyboard.press("Control+B");
  expect((await sidebar.boundingBox())?.width).toBe(before);
  await app.close();
});

test("the inspector's width and whether it is open survive a restart, and it stays between 280 and 480", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const win = await first.app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 900 });
  await win.getByTestId("rail-board").click();
  const panel = win.getByTestId("inspector");
  await expect(panel).toBeVisible();
  const grip = await win.getByTestId("inspector-resizer").boundingBox();
  if (!grip) throw new Error("no resizer");
  const y = grip.y + grip.height / 2;
  await win.mouse.move(grip.x + 3, y);
  await win.mouse.down();
  await win.mouse.move(grip.x - 500, y, { steps: 5 });
  await win.mouse.up();
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(480);
  await expect
    .poll(() =>
      win.evaluate(() => window.office.invoke("settings.get").then((s) => s.inspectorWidth)),
    )
    .toBe(480);
  const grip2 = await win.getByTestId("inspector-resizer").boundingBox();
  if (!grip2) throw new Error("no resizer");
  await win.mouse.move(grip2.x + 3, y);
  await win.mouse.down();
  await win.mouse.move(grip2.x + 400, y, { steps: 5 });
  await win.mouse.up();
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(280);
  await expect
    .poll(() =>
      win.evaluate(() => window.office.invoke("settings.get").then((s) => s.inspectorWidth)),
    )
    .toBe(280);
  // Hidden on the Board, shown on Git: per view.
  await win.getByTestId("inspector-toggle").click();
  await expect(panel).toBeHidden();
  await expect
    .poll(() =>
      win.evaluate(() =>
        window.office.invoke("settings.get").then((s) => s.inspectorHidden["board"]),
      ),
    )
    .toBe(true);
  await first.app.close();

  const second = await launch({ base: first.base, fakeTools: true });
  const again = await second.app.firstWindow();
  await again.setViewportSize({ width: 1700, height: 900 });
  await again.getByTestId("rail-board").click();
  await expect(again.getByTestId("inspector")).toBeHidden();
  await again.getByTestId("rail-git").click();
  await expect(again.getByTestId("inspector")).toBeVisible();
  await expect
    .poll(async () => Math.round((await again.getByTestId("inspector").boundingBox())?.width ?? 0))
    .toBe(280);
  await second.app.close();
});
