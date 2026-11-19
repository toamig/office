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
  await pick(win, "role-model", "haiku");
  await win.getByTestId("role-effort-high").click();
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
  await win.getByTestId("new-role").click();
  await win.getByTestId("new-role-id").fill("qa");
  await win.getByTestId("new-role-create").click();
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

test("a role whose model does not fit its provider says so and can be fixed, and effort follows the provider", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  // The owner's case: Claude Code paired with a model that is not Claude's.
  await win.evaluate(() =>
    window.office.invoke("roles.save", {
      id: "mixed",
      role: {
        provider: "claude-code",
        model: "gpt-6.1-terra",
        instructions: "",
        permissionProfile: "ask-first",
        readOnly: false,
        allowedCommands: [],
      },
    }),
  );
  await win.getByTestId("rail-board").click();
  await win.getByTestId("board-tab-roles").click();
  await win.getByTestId("role-row").filter({ hasText: "Mixed" }).click();
  await expect(win.getByTestId("role-model-mismatch")).toContainText("does not fit this provider");
  await win.getByTestId("role-model-fix").click();
  await expect(win.getByTestId("role-model-mismatch")).toHaveCount(0);
  await expect(win.getByTestId("role-model")).toContainText("The tool's default");

  // Claude Code accepts Max; Codex has no such level, so it is not offered there.
  await expect(win.getByTestId("role-effort-max")).toBeVisible();
  await pick(win, "role-provider", { label: "Codex" });
  await expect(win.getByTestId("role-effort-max")).toHaveCount(0);
  await expect(win.getByTestId("role-effort-xhigh")).toBeVisible();
  await app.close();
});
