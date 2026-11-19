import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, pick, toasts } from "./helpers";

test("editing a role round-trips through the workspace file", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-board").click();
  await win.getByTestId("board-tab-roles").click();
  await win.getByTestId("role-row").filter({ hasText: "builder" }).click();
  await win.getByTestId("role-model").fill("haiku");
  await pick(win, "role-effort", "high");
  await win.getByTestId("role-instructions").fill("Build carefully.");
  await win.getByTestId("role-save").click();
  await expect(toasts(win).filter({ hasText: "Role saved" })).toBeVisible();

  const file = JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  expect(file.roles.builder).toMatchObject({
    model: "haiku",
    effort: "high",
    instructions: "Build carefully.",
  });

  // A new role, and a project override that the Start agent dialog's role picker will honour.
  await win.getByTestId("new-role-id").fill("qa");
  await win.getByTestId("new-role").click();
  await expect(win.getByTestId("role-row").filter({ hasText: "qa" })).toBeVisible();
  await pick(win, "override-project", { label: "Alpha" });
  await pick(win, "override-builder", "qa");
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8")).projects[0]
          .roles,
      { timeout: 30000 },
    )
    .toEqual({ builder: "qa" });

  // The planner is used by the feature pipeline, so deleting it is refused with a clear reason.
  await win.getByTestId("role-row").filter({ hasText: "planner" }).click();
  await win.getByTestId("role-remove").click();
  await expect(toasts(win).filter({ hasText: "used by the" })).toBeVisible();
  await app.close();
});
