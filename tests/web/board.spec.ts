import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "../fixtures/repos/make";
import { launch } from "./helpers";

test("Home shows a waiting item, opens its project and ticks it done", async () => {
  const { app, world } = await launch({ world: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();

  await expect(win.getByTestId("home")).toBeVisible();
  const items = win.locator('[data-testid="pending-item"][data-kind="waiting"]');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Decide the sheep and enemy balance");

  await items.first().getByTestId("pending-open").click();
  await expect(win.getByTestId("project-page")).toContainText("Alpha");
  await win.getByTestId("tab-todos").click();
  await expect(win.getByTestId("project-waiting")).toHaveCount(2);

  await win.getByTestId("project-waiting").first().getByTestId("project-done").click();
  await expect(win.getByTestId("project-waiting")).toHaveCount(1);

  const file = readFileSync(join(world.hub, "Alpha", "OpenItems.md"), "utf8");
  expect(file).not.toContain("Decide the sheep and enemy balance");
  expect(file).toContain("Review the three blog drafts");
  // The file watcher refreshes the list a moment before the commit lands, so wait for it.
  await expect
    .poll(() => sh(join(world.hub, "Alpha"), "log", "-1", "--format=%s").trim(), { timeout: 15000 })
    .toBe("Alpha: done: Decide the sheep and enemy balance");
  await app.close();
});

test("Home done button works too, and the project list shows git state", async () => {
  const { app } = await launch({ world: true });
  const win = await app.firstWindow();
  await win.getByTestId("pending-done").first().click();
  await expect(win.locator('[data-testid="pending-item"][data-kind="waiting"]')).toHaveCount(1);

  await win.getByTestId("rail-projects").click();
  await expect(win.getByTestId("project-card")).toHaveCount(2); // a pinned project is listed once, under Pinned
  await expect(win.getByTestId("projects")).toContainText("main");
  await app.close();
});

test("the quick switcher jumps to a project", async () => {
  const { app } = await launch({ world: true });
  const win = await app.firstWindow();
  await win.getByTestId("switcher-button").click();
  await expect(win.getByTestId("switcher")).toBeVisible();
  await win.keyboard.press("Escape");
  await expect(win.getByTestId("switcher")).toHaveCount(0);
  await win.keyboard.press("Control+k");
  await win.getByLabel("Quick switcher").fill("bet");
  await expect(win.getByTestId("switcher-item").first()).toContainText("Beta");
  await win.keyboard.press("Enter");
  await expect(win.getByTestId("project-page")).toContainText("Beta");
  await app.close();
});
