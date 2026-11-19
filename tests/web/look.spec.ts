import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, repoRoot } from "./helpers";

// Captures every view in light and dark into test-results/look/ (not committed) so each image can be looked at.
const out = join(repoRoot, "test-results", "look");

const VIEWS = [
  "home",
  "projects",
  "agents",
  "git",
  "board",
  "brain",
  "inbox",
  "explore",
  "setup",
] as const;

/** What must never be on screen: a raw status id, a config key, or a value the code forgot to fill in. */
const RAW =
  /needs-you|waiting-gate|waiting-permission|up-to-date|workspaceConfigPath|\bundefined\b|\[object|\bNaN\b|__\w+__/;

async function shoot(win: Page, name: string, theme: string, width = 1366): Promise<void> {
  await win.waitForTimeout(350);
  const main = (await win.locator("main, .welcome").first().innerText()).slice(0, 20000);
  expect(RAW.exec(main)?.[0] ?? null, `raw text in ${name}`).toBeNull();
  await win.screenshot({ path: join(out, `${theme}-${width}-${name}.png`) });
}

// One test per theme and width, so they run side by side.
for (const only of ["light", "dark"] as const)
  for (const [width, height] of [
    [1366, 860],
    [1920, 1080],
  ] as const)
    test(`every view in ${only} at ${width} wide`, async () => {
      mkdirSync(out, { recursive: true });
      const { app } = await launch({ world: true, fakeTools: true });
      const win = await app.firstWindow();
      await win.setViewportSize({ width, height });
      await expect(win.getByTestId("topbar")).toBeVisible();

      // Give the screens something to show: a running agent, a task at its gate, a permission request.
      await win.evaluate(() =>
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
      await win.evaluate(() =>
        window.office.invoke("tasks.create", {
          projectId: "beta",
          pipeline: "perm",
          title: "Clean the build",
          description: "rm -rf build",
          fanout: 1,
        }),
      );
      await expect(win.getByTestId("permission-request")).toBeVisible({ timeout: 60000 });

      // A chat with a tool call, an edit, a checklist and an open approval.
      const chat = await win.evaluate(() =>
        window.office.invoke("sessions.start", {
          providerId: "fake",
          projectId: "alpha",
          title: "Chat design",
          mode: "chat",
        }),
      );
      await win.evaluate(
        (id) =>
          window.office.invoke("chat.send", {
            id,
            text: "THINK READ src/sheep.ts EDIT TODO RUN npm test",
          }),
        chat.id,
      );
      await expect
        .poll(
          async () =>
            (
              await win.evaluate((id) => window.office.invoke("chat.history", { id }), chat.id)
            ).some((l) => l.event.t === "result"),
          { timeout: 30000 },
        )
        .toBe(true);
      await win.evaluate(
        (id) => window.office.invoke("chat.send", { id, text: "NEEDS_PERMISSION: rm -rf build" }),
        chat.id,
      );

      for (const theme of [only] as const) {
        await win.evaluate((t) => window.office.invoke("settings.set", { theme: t }), theme);
        await expect
          .poll(() => win.evaluate(() => document.documentElement.getAttribute("data-theme")))
          .toBe(theme);
        for (const view of VIEWS) {
          await win.getByTestId(`rail-${view}`).click();
          if (view === "agents") {
            await win.getByTestId("session-row").filter({ hasText: "Level work" }).click();
            await expect(win.locator('[data-testid="terminal"]')).toBeVisible();
            await win.waitForTimeout(600);
          }
          await shoot(win, view, theme, width);
        }
        await win.getByTestId("rail-agents").click();
        await win.getByTestId("session-row").filter({ hasText: "Chat design" }).click();
        await expect(win.getByTestId("chat")).toBeVisible();
        await win.waitForTimeout(700);
        await shoot(win, "chat", theme, width);
        // A project page, the quick switcher, the shortcuts sheet and a collapsed sidebar.
        await win.getByTestId("rail-projects").click();
        await win.getByTestId("project-card").first().click();
        await win.waitForTimeout(500);
        await shoot(win, "project", theme, width);
        await win.getByTestId("switcher-button").click();
        await shoot(win, "switcher", theme, width);
        await win.keyboard.press("Escape");
        await win.keyboard.press("Control+/");
        await shoot(win, "shortcuts", theme, width);
        await win.keyboard.press("Escape");
        await win.getByTestId("sidebar-toggle").click();
        await win.getByTestId("rail-home").click();
        await shoot(win, "home-collapsed", theme, width);
        await win.getByTestId("sidebar-toggle").click();
      }
      await app.close();
    });

for (const only of ["light", "dark"] as const)
  test(`the welcome flow, every step, in ${only}`, async () => {
    mkdirSync(out, { recursive: true });
    for (const theme of [only] as const) {
      const { app, world } = await launch({ world: "unconfigured", fakeTools: true });
      if (!world) throw new Error("no world");
      const win = await app.firstWindow();
      await expect(win.getByTestId("welcome")).toBeVisible();
      await win.evaluate((t) => window.office.invoke("settings.set", { theme: t }), theme);
      await shoot(win, "welcome-1-workspace", theme);
      await win.getByTestId("mode-folder").click();
      await win.getByTestId("setup-root").fill(world.hub);
      await win.getByTestId("setup-use-folder").click();
      await expect(win.getByTestId("setup-config")).toBeVisible();
      await shoot(win, "welcome-1b-config", theme);
      await win.getByTestId("setup-use-workspace").click();
      await win.getByTestId("welcome-continue").click();
      await shoot(win, "welcome-2-projects", theme);
      await win.getByTestId("setup-projects").fill(world.projectsRoot);
      await win.getByTestId("setup-projects").press("Enter");
      await win.getByTestId("welcome-continue").click();
      await expect(win.getByTestId("tool-row")).toHaveCount(5);
      await shoot(win, "welcome-3-tools", theme);
      await win.getByTestId("welcome-continue").click();
      await expect(win.getByTestId("add-projects")).toBeVisible();
      await shoot(win, "welcome-3b-add-projects", theme);
      await win.getByTestId("welcome-continue").click();
      await expect(win.getByTestId("hooks-rows")).toBeVisible();
      await shoot(win, "welcome-4-notifications", theme);
      await app.close();
    }
  });

/** Logs how long each step of a dialog test took, so a stall names the step it was in. */
function stopwatch(name: string): (step: string) => void {
  const start = Date.now();
  return (step) => console.log(`[${name}] ${step} at ${Date.now() - start} ms`);
}

// One test per dialog, each waiting for its own dialog to be open, so a failure names the dialog.
test("the hook install dialog, in plain words", async () => {
  mkdirSync(out, { recursive: true });
  const lap = stopwatch("hooks dialog");
  const { app, page: win } = await launch({ world: true, fakeTools: true });
  await win.getByTestId("rail-setup").click();
  await win.getByTestId("install-claude").click();
  await expect(win.getByTestId("hooks-consent")).toBeVisible({ timeout: 30000 });
  lap("open");
  await shoot(win, "hooks-dialog", "light");
  await win.getByTestId("hooks-diff-toggle").click();
  await shoot(win, "hooks-dialog-diff", "light");
  await win.getByTestId("hooks-cancel").click();
  await expect(win.getByTestId("hooks-consent")).toBeHidden({ timeout: 30000 });
  lap("closed");
  await app.close();
});

test("the tool login dialog opens and closes, and the tools are checked again", async () => {
  mkdirSync(out, { recursive: true });
  const lap = stopwatch("tool dialog");
  const { app, page: win } = await launch({ world: true, fakeTools: true });
  await win.getByTestId("rail-setup").click();
  await app.setEnv({ FAKE_LOGGED_IN: "0" });
  await win.getByTestId("tools-check").click();
  await expect(win.getByTestId("tool-login").first()).toBeVisible({ timeout: 45000 });
  lap("login offered");
  await win.getByTestId("tool-login").first().click();
  await expect(win.getByTestId("tool-dialog")).toBeVisible({ timeout: 30000 });
  lap("open");
  await shoot(win, "tool-dialog", "light");
  await win.getByTestId("tool-dialog-close").click();
  await expect(win.getByTestId("tool-dialog")).toBeHidden({ timeout: 30000 });
  // Closing checks the tools again; the button is disabled while that runs.
  await expect(win.getByTestId("tools-check")).toBeEnabled({ timeout: 45000 });
  lap("tools checked again");
  await app.close();
});

test("the projects folder with everything missing, and the Projects page", async () => {
  mkdirSync(out, { recursive: true });
  const lap = stopwatch("projects folder");
  const { app, page: win, world, base } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  await win.getByTestId("rail-setup").click();
  const empty = join(base, "nothing");
  mkdirSync(empty, { recursive: true });
  await win.getByTestId("setup-projects").fill(empty);
  await win.getByTestId("setup-projects").press("Enter");
  // The folder holds none of the projects, so Office asks before using it.
  await expect(win.getByTestId("projects-use-anyway")).toBeVisible({ timeout: 45000 });
  lap("asked");
  await shoot(win, "projects-folder-none", "light");
  await win.getByTestId("projects-use-anyway").click();
  await win.getByTestId("rail-projects").click();
  await expect(win.getByTestId("project-card").first()).toBeVisible({ timeout: 30000 });
  lap("projects page");
  await shoot(win, "projects-missing", "light");
  await app.close();
});

// The M11 screens: the Board's editors, the pipeline diagram, the inspector and the docked workbenches.
for (const only of ["light", "dark"] as const)
  for (const [width, height] of [
    [1366, 860],
    [1920, 1080],
  ] as const)
    test(`the M11 screens in ${only} at ${width} wide`, async () => {
      mkdirSync(out, { recursive: true });
      const { app } = await launch({ world: true, fakeTools: true });
      const win = await app.firstWindow();
      await win.setViewportSize({ width, height });
      await win.evaluate((t) => window.office.invoke("settings.set", { theme: t }), only);
      await expect
        .poll(() => win.evaluate(() => document.documentElement.getAttribute("data-theme")))
        .toBe(only);
      await win.evaluate(async () => {
        await window.office.invoke("sessions.start", {
          providerId: "fake",
          projectId: "alpha",
          title: "Level work",
          mode: "terminal",
        });
        await window.office.invoke("sessions.start", {
          providerId: "fake",
          projectId: "alpha",
          title: "Chat work",
          mode: "chat",
        });
        await window.office.invoke("tasks.create", {
          projectId: "alpha",
          pipeline: "feature",
          title: "Add a sheep counter",
          description: "Plan it.",
          fanout: 1,
        });
      });
      // The Board: a task with its diagram, in the inspector too, then the three editors.
      await win.getByTestId("rail-board").click();
      await expect(win.getByTestId("task-card")).toHaveCount(1, { timeout: 60000 });
      await win.getByTestId("task-card").click();
      await expect(win.getByTestId("inspector-diagram")).toBeVisible();
      await shoot(win, "m11-board-task", only, width);
      await win.getByTestId("board-tab-pipelines").click();
      await shoot(win, "m11-board-pipelines", only, width);
      await win.getByTestId("board-tab-roles").click();
      await shoot(win, "m11-board-roles", only, width);
      await win.getByTestId("board-tab-permissions").click();
      await shoot(win, "m11-board-permissions", only, width);
      // Agents as a dock, with the review layout and the inspector.
      await win.getByTestId("rail-agents").click();
      await win.getByTestId("session-row").filter({ hasText: "Level work" }).click();
      await win.getByTestId("session-row").filter({ hasText: "Chat work" }).click();
      await expect(win.getByTestId("chat")).toBeVisible();
      await win.waitForTimeout(600);
      await shoot(win, "m11-agents-dock", only, width);
      await win.getByTestId("workbench-layout").click();
      await win
        .getByTestId("workbench-layout-menu")
        .getByRole("menuitem", { name: "Arrange: Review: conversation, changes and preview" })
        .click();
      await win.waitForTimeout(600);
      await shoot(win, "m11-agents-review", only, width);
      // The project page and the Git desk as docks.
      await win.getByTestId("rail-projects").click();
      await win.getByTestId("project-card").first().click();
      await win.waitForTimeout(500);
      await shoot(win, "m11-project-dock", only, width);
      await win.getByTestId("rail-git").click();
      await win.getByTestId("git-repo").first().click();
      await win.waitForTimeout(500);
      await shoot(win, "m11-git-dock", only, width);
      await app.close();
    });
