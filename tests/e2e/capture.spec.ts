import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "../fixtures/repos/make";
import { launch } from "./helpers";

test("closing a session lists what is left and saves the items into the vault", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Level work",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await expect(win.getByTestId("session-row")).toHaveCount(1);
  await win.getByTestId("close-session").click();

  await expect(win.getByTestId("capture-dialog")).toBeVisible();
  const items = win.getByTestId("capture-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByLabel("Item text")).toHaveValue("Decide the art style");
  await expect(items.nth(0).getByLabel("Where it goes")).toHaveValue("waiting");
  await expect(items.nth(1).getByLabel("Where it goes")).toHaveValue("todo");

  // Items can be edited before saving.
  await items.nth(1).getByLabel("Item text").fill("Write the level three script");
  await win.getByTestId("capture-save").click();
  await expect(win.getByTestId("capture-dialog")).toHaveCount(0);
  await expect(win.getByTestId("session-row")).toHaveCount(0, { timeout: 40000 });

  const file = readFileSync(join(world.hub, "Alpha", "OpenItems.md"), "utf8");
  expect(file).toMatch(
    /- \[ \] \d{4}-\d{2}-\d{2} Decide the art style \(from the Level work session\)/,
  );
  expect(file).toContain("## Session leftovers");
  expect(file).toContain("Write the level three script (from the Level work session)");
  await expect
    .poll(() => sh(join(world.hub, "Alpha"), "log", "-3", "--format=%s"), { timeout: 20000 })
    .toContain("Alpha: todo: Write the level three script");
  expect(sh(world.remotes["Alpha"] as string, "log", "-1", "--format=%s")).toContain("Alpha:");
  await app.close();
});

test("archiving without saving leaves the vault alone", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const before = readFileSync(join(world.hub, "Alpha", "OpenItems.md"), "utf8");
  const win = await app.firstWindow();
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Skipped",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("close-session").click();
  await expect(win.getByTestId("capture-item")).toHaveCount(2);
  await win.getByTestId("capture-skip").click();
  await expect(win.getByTestId("session-row")).toHaveCount(0, { timeout: 40000 });
  expect(readFileSync(join(world.hub, "Alpha", "OpenItems.md"), "utf8")).toBe(before);
  await app.close();
});
