import { expect, test, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, pageMenu, toasts } from "./helpers";

/** Where an element is in the page, however far the page is scrolled: only a change of layout moves it. */
const pageY = (el: Locator): Promise<number> =>
  el.evaluate((node) => {
    let y = 0;
    for (
      let n: HTMLElement | null = node as HTMLElement;
      n;
      n = n.offsetParent as HTMLElement | null
    )
      y += n.offsetTop;
    return y;
  });

test("the result of Sync, Save and Go is a notification: it never draws a bar or moves the page, and a good result leaves by itself", async () => {
  const { app, base } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const bars = win.locator(".ui-banner");

  // Sync, from a project page.
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).first().click();
  const tabs = win.getByTestId("tab-overview");
  const top = await pageY(tabs);
  await pageMenu(win, "project-sync");
  const synced = toasts(win).filter({ hasText: "Alpha" });
  await expect(synced).toBeVisible();
  // It reads "up to date" as the good result it is, in the success colour, not as an error.
  await expect(synced).toContainText(/up to date/i);
  await expect(synced).toHaveAttribute("data-tone", "success");
  await expect(bars).toHaveCount(0);
  expect(await pageY(tabs)).toBe(top);
  await expect(synced).toHaveCount(0, { timeout: 9000 });

  // Save, in Setup.
  await win.getByTestId("rail-setup").click();
  const folder = join(base, "art-vault");
  mkdirSync(folder, { recursive: true });
  await win.getByTestId("art-vault").fill(folder);
  const setupTop = await pageY(win.getByTestId("art-vault"));
  await win.getByTestId("art-vault-save").click();
  const saved = toasts(win).filter({ hasText: "Saved" });
  await expect(saved).toBeVisible();
  await expect(saved).toHaveAttribute("data-tone", "success");
  await expect(bars).toHaveCount(0);
  expect(await pageY(win.getByTestId("art-vault"))).toBe(setupTop);
  await expect(saved).toHaveCount(0, { timeout: 9000 });

  // Go, in the preview. This host has no preview pane, so the result is an error: it is a notification too,
  // it stays until it is closed, and the page does not move.
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).first().click();
  await win.getByTestId("tab-preview").click();
  await win.getByTestId("preview-url").fill("localhost:5173");
  const previewTop = await pageY(win.getByTestId("preview-url"));
  await win.getByTestId("preview-go").click();
  const failed = toasts(win).filter({ hasText: "Could not open that address" });
  await expect(failed).toBeVisible();
  await expect(failed).toHaveAttribute("data-tone", "danger");
  await expect(bars).toHaveCount(0);
  expect(await pageY(win.getByTestId("preview-url"))).toBe(previewTop);
  await win.waitForTimeout(5000);
  await expect(failed).toBeVisible();
  await failed.getByRole("button", { name: "Close notification" }).click();
  await expect(failed).toHaveCount(0);
  await app.close();
});

test("a lasting problem is a banner, and it goes away by itself when it is fixed", async () => {
  const { app, world, base } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-projects").click();
  // With the projects folder pointed at an empty one, every project folder is missing: that is a banner.
  const empty = join(base, "empty-projects-root");
  mkdirSync(empty, { recursive: true });
  await win.evaluate((p) => window.office.invoke("setup.setProjectsRoot", { path: p }), empty);
  await expect(win.getByTestId("all-folders-missing")).toBeVisible();
  await expect(win.getByTestId("all-folders-missing")).toHaveClass(/ui-banner/);
  await win.evaluate(
    (p) => window.office.invoke("setup.setProjectsRoot", { path: p }),
    world.projectsRoot,
  );
  await expect(win.getByTestId("all-folders-missing")).toHaveCount(0);
  await app.close();
});
