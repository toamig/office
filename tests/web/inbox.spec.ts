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
  await expect(win.getByTestId("notification")).toHaveCount(1);
  await expect(win.getByTestId("notification")).toContainText("Sync conflict in Alpha");
  await win.getByTestId("mark-all-read").click();
  await expect(win.getByTestId("inbox-count")).toHaveCount(0);
  await app.close();
});
