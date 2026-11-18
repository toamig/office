import { expect, test, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./helpers";

const claudeRow = (win: Page): Locator =>
  win.getByTestId("tool-row").filter({ has: win.getByText("Claude Code", { exact: true }) });
const fakeClaude = join(__dirname, "../fixtures/bin/fake-claude.mjs");

test("an empty app-data folder opens the welcome flow, with no sidebar, and walks through to Home", async () => {
  const { app, world, data } = await launch({ world: "unconfigured", fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();

  // Only the welcome flow: no sidebar and no views.
  await expect(win.getByTestId("welcome")).toBeVisible();
  await expect(win.getByTestId("rail")).toHaveCount(0);
  await expect(win.getByTestId("home")).toHaveCount(0);
  await expect(win.getByTestId("welcome-progress")).toContainText("Workspace");
  await expect(win.getByTestId("welcome-progress")).toContainText("Projects folder");
  await expect(win.getByTestId("welcome-progress")).toContainText("Tools");
  await expect(win.getByTestId("welcome-progress")).toContainText("Agent notifications");
  await expect(win.getByTestId("welcome-step-workspace")).toHaveAttribute("data-state", "current");

  // Step 1: Continue stays off, with a one-line reason, until the workspace is chosen.
  await expect(win.getByTestId("welcome-continue")).toBeDisabled();
  await expect(win.getByTestId("welcome-reason")).toContainText("Choose or clone");
  await win.getByTestId("setup-root").fill(world.hub);
  await win.getByTestId("setup-use-folder").click();
  await expect(win.getByTestId("setup-config")).toHaveValue("Office/workspace.json");
  await win.getByTestId("setup-use-workspace").click();
  await expect(win.getByTestId("welcome-continue")).toBeEnabled();
  await win.getByTestId("welcome-continue").click();

  // Step 2: the projects folder.
  await expect(win.getByTestId("welcome-step-projects")).toHaveAttribute("data-state", "current");
  await expect(win.getByTestId("welcome-continue")).toBeDisabled();
  await expect(win.getByTestId("welcome-reason")).toContainText("Choose the folder your projects");
  await win.getByTestId("setup-projects").fill(world.projectsRoot);
  await win.getByTestId("setup-projects-save").click();
  await expect(win.getByTestId("welcome-continue")).toBeEnabled();
  await win.getByTestId("welcome-continue").click();

  // Step 3: the tools. The fake tools are ready (Git, and a Claude Code that is logged in).
  await expect(win.getByTestId("tools-step")).toBeVisible();
  await expect(claudeRow(win)).toContainText(
    "logged in",
  );
  await expect(win.getByTestId("welcome-continue")).toBeEnabled();
  await win.getByTestId("welcome-continue").click();

  // Step 4: notifications are optional. Skip reaches Home.
  await expect(win.getByTestId("hooks-rows")).toBeVisible();
  await expect(win.getByTestId("welcome-finish")).toHaveText("Skip");
  await win.getByTestId("welcome-finish").click();
  await expect(win.getByTestId("home")).toBeVisible();
  await expect(win.getByTestId("rail")).toBeVisible();
  await expect(win.getByTestId("welcome")).toHaveCount(0);
  await expect(win.getByTestId("waiting-item")).toHaveCount(2);

  const saved = JSON.parse(readFileSync(join(data, "settings.json"), "utf8"));
  expect(saved).toMatchObject({ projectsRoot: world.projectsRoot, welcomeDone: true });

  // Setup holds the same choices as plain settings, and the hooks were not touched by Skip.
  await win.getByTestId("rail-setup").click();
  await expect(win.getByTestId("workspace-summary")).toContainText(world.hub);
  await app.close();
});

test("a required step stays closed until it is met: tools missing, then not logged in, then ready", async () => {
  const { app, base } = await launch({
    world: true,
    fakeTools: true,
    settings: { welcomeDone: false },
    env: {
      OFFICE_BIN_CLAUDE: join(__dirname, "no-such-claude"),
      OFFICE_BIN_CODEX: join(__dirname, "no-such-codex"),
    },
  });
  void base;
  const win = await app.firstWindow();

  // The workspace and projects folder are set, so the flow opens on the tools step.
  await expect(win.getByTestId("welcome-step-tools")).toHaveAttribute("data-state", "current");
  await expect(claudeRow(win)).toContainText(
    "missing",
  );
  await expect(win.getByTestId("welcome-continue")).toBeDisabled();
  await expect(win.getByTestId("welcome-reason")).toContainText("Install Claude Code or Codex");

  // Installed, but not logged in: the reason changes and Log in appears.
  await app.evaluate(
    (_electron, claude) => {
      process.env["OFFICE_BIN_CLAUDE"] = claude;
      process.env["FAKE_LOGGED_IN"] = "0";
    },
    fakeClaude,
  );
  await win.getByTestId("tools-check").click();
  await expect(win.getByTestId("welcome-reason")).toContainText("Log in to Claude Code or Codex");
  await expect(win.getByTestId("welcome-continue")).toBeDisabled();
  const claude = claudeRow(win);
  await expect(claude).toContainText("not logged in");

  // Log in opens the tool's own login in a terminal right here, inside the step.
  await claude.getByTestId("tool-login").click();
  await expect(win.getByTestId("tool-terminal")).toBeVisible();
  await expect(win.getByTestId("rail")).toHaveCount(0);

  // Logged in: Check again, and Continue is on.
  await app.evaluate(() => {
    process.env["FAKE_LOGGED_IN"] = "1";
  });
  await win.getByTestId("tools-check").click();
  await expect(claude).toContainText("logged in");
  await expect(win.getByTestId("welcome-continue")).toBeEnabled();
  await app.close();
});

test("Back goes to the step before, and Continue is not offered past a step that is not met", async () => {
  const { app } = await launch({
    world: true,
    fakeTools: true,
    settings: { welcomeDone: false },
  });
  const win = await app.firstWindow();
  // The workspace and the projects folder are set, so the flow opens on the tools step.
  await expect(win.getByTestId("welcome-step-tools")).toHaveAttribute("data-state", "current");
  await win.getByTestId("welcome-back").click();
  await expect(win.getByTestId("welcome-step-projects")).toHaveAttribute("data-state", "current");
  await win.getByTestId("welcome-back").click();
  await expect(win.getByTestId("welcome-step-workspace")).toHaveAttribute("data-state", "current");
  await expect(win.getByTestId("welcome-back")).toBeDisabled();
  // The workspace step is already met here, so Continue is on.
  await expect(win.getByTestId("welcome-continue")).toBeEnabled();
  await app.close();
});

test("removing the workspace folder and restarting opens the first step again", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const { world, base } = first;
  if (!world) throw new Error("no world");
  const win = await first.app.firstWindow();
  await expect(win.getByTestId("home")).toBeVisible();
  await first.app.close();

  rmSync(world.hub, { recursive: true, force: true });
  expect(existsSync(world.hub)).toBe(false);

  const second = await launch({ base, fakeTools: true });
  const again = await second.app.firstWindow();
  await expect(again.getByTestId("welcome")).toBeVisible();
  await expect(again.getByTestId("welcome-step-workspace")).toHaveAttribute(
    "data-state",
    "current",
  );
  await expect(again.getByTestId("welcome-reason")).toContainText("is gone");
  await expect(again.getByTestId("rail")).toHaveCount(0);
  await second.app.close();
});

test("a machine that was set up before the flow existed goes straight to Home and is marked done", async () => {
  // Nothing recorded about the flow, as in a settings file written by an earlier version.
  const { app, data } = await launch({
    world: true,
    fakeTools: true,
    settings: { welcomeDone: undefined },
  });
  const win = await app.firstWindow();
  await expect(win.getByTestId("home")).toBeVisible();
  await expect(win.getByTestId("welcome")).toHaveCount(0);
  await expect
    .poll(() => JSON.parse(readFileSync(join(data, "settings.json"), "utf8")).welcomeDone)
    .toBe(true);
  await app.close();
});
