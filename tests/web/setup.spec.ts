import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, pick, toasts } from "./helpers";

test("Setup shows the workspace, the tools with their problems and fixes, and the inventory", async () => {
  const { app, world, data } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await expect(win.getByTestId("home")).toBeVisible();
  await expect(win.getByTestId("waiting-item")).toHaveCount(2);
  await win.getByTestId("rail-setup").click();

  await expect(win.getByTestId("workspace-summary")).toContainText(world.hub);
  expect(JSON.parse(readFileSync(join(data, "settings.json"), "utf8")).projectsRoot).toBe(
    world.projectsRoot,
  );

  // The tools table shows the Codex config problem with its fix.
  const codex = win
    .getByTestId("tool-row")
    .filter({ has: win.getByText("Codex", { exact: true }) });
  // One short line with its Run button; the command is in the button's tooltip.
  await expect(codex.getByTestId("tool-update")).toContainText("Update available");
  await expect(codex.getByTestId("tool-run")).toHaveAttribute("title", /npm i -g @openai\/codex/);
  // "One of Claude Code or Codex is required" shows only while no agent tool is ready.
  await expect(win.getByTestId("tool-needed")).toHaveCount(0);
  await expect(
    win.getByTestId("tool-row").filter({ has: win.getByText("Claude Code", { exact: true }) }),
  ).toContainText(/logged in/i);

  // The inventory is read from the fake home, read only.
  await expect(win.getByTestId("inventory")).toContainText("example-plugin@market");
  await expect(win.getByTestId("inventory")).toContainText("gpt-5-codex");

  // Projects are available straight away.
  await win.getByTestId("rail-projects").click();
  await expect(win.getByTestId("project-card").first()).toBeVisible();
  await app.close();
});

test("the welcome flow clones a workspace repo from a git URL", async () => {
  const { app, world, base } = await launch({ world: "unconfigured", fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  const dest = join(base, "cloned-hub");
  await win.getByTestId("mode-clone").check();
  await win.getByTestId("setup-url").fill(world.remotes["."] as string);
  await win.getByTestId("setup-dest").fill(dest);
  await win.getByTestId("setup-clone").click();
  await expect(win.getByTestId("setup-config")).toHaveValue("Office/workspace.json");
  expect(existsSync(join(dest, "brain.repos.json"))).toBe(true);
  await app.close();
});

test("a bad folder shows a clear error and keeps the welcome step open", async () => {
  const { app, base } = await launch({ world: "unconfigured" });
  const win = await app.firstWindow();
  await win.getByTestId("mode-folder").click();
  await win.getByTestId("setup-root").fill(join(base, "nowhere"));
  await win.getByTestId("setup-use-folder").click();
  await expect(toasts(win).filter({ hasText: "is not a folder" })).toBeVisible();
  await app.close();
});

test("automations: add one, run it now, and see it finish", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-setup").click();
  await win.getByTestId("automation-id").fill("nightly-brief");
  await win.getByTestId("automation-cron").fill("0 3 * * *");
  await pick(win, "automation-project", { label: "Alpha" });
  await pick(win, "automation-role", "researcher");
  await win.getByTestId("automation-prompt").fill("Summarise yesterday");
  await win.getByTestId("automation-save").click();
  const row = win.getByTestId("automation-row").filter({ hasText: "nightly-brief" });
  await expect(row).toContainText(/last run never/i);
  const config = JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  expect(config.automations).toEqual([
    {
      id: "nightly-brief",
      cron: "0 3 * * *",
      project: "alpha",
      role: "researcher",
      prompt: "Summarise yesterday",
      enabled: true,
    },
  ]);

  await row.getByTestId("automation-run").click();
  await expect(row).toContainText(/last run just now/i, { timeout: 60000 });
  await win.getByTestId("rail-inbox").click();
  await expect(win.getByTestId("notification").first()).toContainText(
    "Automation finished: nightly-brief",
  );

  await win.getByTestId("rail-setup").click();
  await win.getByTestId("automation-cron").fill("every day");
  await win.getByTestId("automation-id").fill("bad-one");
  await pick(win, "automation-project", { label: "Alpha" });
  await win.getByTestId("automation-prompt").fill("x");
  await win.getByTestId("automation-save").click();
  await expect(toasts(win).filter({ hasText: "not a valid cron expression" })).toBeVisible();
  await app.close();
});

test("About shows the version and says updates are off while running against test data", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-setup").click();
  await expect(win.getByTestId("about")).toContainText("0.1.0");
  await expect(win.getByTestId("about")).toContainText("Updates are off");
  await expect(win.getByTestId("update-check")).toBeDisabled();
  await app.close();
});
