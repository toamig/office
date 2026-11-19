import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, pageMenu } from "./helpers";

test("a project can be pinned, grouped, archived and restored from the app", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  const config = (): { projects: Array<Record<string, unknown>> } =>
    JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  const alpha = (): Record<string, unknown> | undefined =>
    config().projects.find((p) => p["id"] === "alpha");

  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).first().click();
  await expect(win.getByTestId("project-page")).toBeVisible();

  await pageMenu(win, "project-pin");
  await expect.poll(() => alpha()?.["pinned"], { timeout: 20000 }).toBe(true);
  await win.getByTestId("page-more").click();
  await expect(win.getByTestId("project-pin")).toContainText("Unpin");
  await win.keyboard.press("Escape");

  await pageMenu(win, "project-group-open");
  await win.getByTestId("project-group").fill("Favourites");
  await win.getByTestId("project-group-save").click();
  await expect.poll(() => alpha()?.["group"], { timeout: 20000 }).toBe("Favourites");

  await pageMenu(win, "project-archive");
  await expect.poll(() => alpha()?.["archived"], { timeout: 20000 }).toBe(true);

  await win.getByTestId("rail-projects").click();
  await expect(win.getByTestId("project-card").filter({ hasText: "Alpha" })).toHaveCount(0);
  await win.getByTestId("toggle-archived").click();
  await win
    .getByTestId("archived-project")
    .filter({ hasText: "Alpha" })
    .getByTestId("restore-project")
    .click();
  await expect.poll(() => alpha()?.["archived"], { timeout: 20000 }).toBe(false);
  await expect(win.getByTestId("project-card").filter({ hasText: "Alpha" }).first()).toBeVisible();
  await app.close();
});
