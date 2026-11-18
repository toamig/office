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

test("every view in light and dark", async () => {
  mkdirSync(out, { recursive: true });
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 40, y: 40, width: 1360, height: 860 });
  });

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

  for (const theme of ["dark", "light"] as const) {
    await win.evaluate((t) => window.office.invoke("settings.set", { theme: t }), theme);
    await expect
      .poll(() => win.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe(theme);
    for (const view of VIEWS) {
      await win.getByTestId(`rail-${view}`).click();
      if (view === "agents") {
        await win.getByTestId("session-row").first().click();
        await expect(win.locator('[data-testid="terminal"]')).toBeVisible();
        await win.waitForTimeout(600);
      }
      await shoot(win, view, theme);
    }
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
