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

async function shoot(win: Page, name: string, theme: string): Promise<void> {
  await win.waitForTimeout(350);
  await win.screenshot({ path: join(out, `${theme}-${name}.png`) });
}

// One test per theme, so the two run side by side.
for (const only of ["light", "dark"] as const)
  test(`every view in ${only}`, async () => {
    mkdirSync(out, { recursive: true });
    const { app } = await launch({ world: true, fakeTools: true });
    const win = await app.firstWindow();
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
          (await win.evaluate((id) => window.office.invoke("chat.history", { id }), chat.id)).some(
            (l) => l.event.t === "result",
          ),
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
        await shoot(win, view, theme);
      }
      await win.getByTestId("rail-agents").click();
      await win.getByTestId("session-row").filter({ hasText: "Chat design" }).click();
      await expect(win.getByTestId("chat")).toBeVisible();
      await win.waitForTimeout(700);
      await shoot(win, "chat", theme);
      // A project page, the quick switcher, the shortcuts sheet and a collapsed sidebar.
      await win.getByTestId("rail-projects").click();
      await win.getByTestId("project-card").first().click();
      await win.waitForTimeout(500);
      await shoot(win, "project", theme);
      await win.getByTestId("switcher-button").click();
      await shoot(win, "switcher", theme);
      await win.keyboard.press("Escape");
      await win.keyboard.press("Control+/");
      await shoot(win, "shortcuts", theme);
      await win.keyboard.press("Escape");
      await win.getByTestId("sidebar-toggle").click();
      await win.getByTestId("rail-home").click();
      await shoot(win, "home-collapsed", theme);
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
      await win.getByTestId("setup-root").fill(world.hub);
      await win.getByTestId("setup-use-folder").click();
      await expect(win.getByTestId("setup-config")).toBeVisible();
      await shoot(win, "welcome-1b-config", theme);
      await win.getByTestId("setup-use-workspace").click();
      await win.getByTestId("welcome-continue").click();
      await shoot(win, "welcome-2-projects", theme);
      await win.getByTestId("setup-projects").fill(world.projectsRoot);
      await win.getByTestId("setup-projects-save").click();
      await win.getByTestId("welcome-continue").click();
      await expect(win.getByTestId("tool-row")).toHaveCount(5);
      await shoot(win, "welcome-3-tools", theme);
      await win.getByTestId("welcome-continue").click();
      await expect(win.getByTestId("hooks-rows")).toBeVisible();
      await shoot(win, "welcome-4-notifications", theme);
      await app.close();
    }
  });
