import { expect, test } from "@playwright/test";
import { commit, sh } from "../fixtures/repos/make";
import { launch, syncAllReport } from "./helpers";

test("a sync conflict lands in the inbox once, even when repeated", async () => {
  const { app, world } = await launch({ world: true });
  if (!world) throw new Error("no world");
  // Make the Alpha code repo conflict with its remote.
  const alpha = world.code["alpha"];
  if (!alpha) throw new Error("no alpha");
  const other = `${world.root}/alpha-other`;
  sh(world.root, "clone", "-q", alpha.bare, other);
  commit(other, "README.md", "# remote\n", "remote edit");
  sh(other, "push", "-q");
  commit(alpha.work, "README.md", "# local\n", "local edit");

  const win = await app.firstWindow();
  const first = await syncAllReport(win);
  await expect(first).toContainText("Conflict");
  await win.getByRole("button", { name: "Close" }).click();
  const second = await syncAllReport(win);
  await expect(second).toBeVisible();
  await win.getByRole("button", { name: "Close" }).click();

  await win.getByTestId("rail-inbox").click();
  // One item however often it was synced, and the badge counts it in the colour of a problem.
  const conflict = win.locator('[data-testid="pending-item"][data-kind="conflict"]');
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText("Sync conflict in Alpha");
  await expect(win.getByTestId("inbox-count")).toHaveAttribute("data-tone", "danger");
  // Dismissing hides it, and it is not kept anywhere.
  await conflict.getByTestId("pending-dismiss").click();
  await expect(conflict).toHaveCount(0);
  // What is left is amber: nothing is broken any more.
  await expect(win.getByTestId("inbox-count")).toHaveAttribute("data-tone", "attention");
  await app.close();
});
