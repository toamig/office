import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "../fixtures/repos/make";
import { launch, terminalText, pick } from "./helpers";

test("Explore runs a chat and the wizard turns it into a project with gh replaced by a fake", async () => {
  const { app, world, ghRemotes } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();

  await win.getByTestId("rail-explore").click();
  await pick(win, "explore-provider", { label: "Fake agent" });
  await win.getByTestId("explore-start").click();
  await expect(win.getByTestId("explore-row")).toHaveCount(1);
  await expect.poll(() => terminalText(win)).toContain("fake-claude ready");

  await win.getByTestId("make-project").click();
  await expect(win.getByTestId("spawn-wizard")).toBeVisible();
  await win.getByTestId("spawn-name").fill("Sheep Dream");
  await win.getByTestId("spawn-stack").fill("a Node and React web app");
  await win.getByTestId("spawn-group").fill("Games");

  // Every step is shown before it runs; nothing exists yet.
  await win.getByTestId("spawn-review").click();
  await expect(win.getByTestId("spawn-step")).toHaveCount(7);
  await expect(win.getByTestId("spawn-steps")).toContainText(
    "gh repo create <you>/sheep-dream --private",
  );
  expect(existsSync(join(world.projectsRoot, "SheepDream"))).toBe(false);

  await win.getByTestId("spawn-run").click();
  await expect(win.getByTestId("spawn-open")).toBeVisible({ timeout: 60000 });
  await expect(win.locator('[data-testid="spawn-step"][data-status="done"]')).toHaveCount(7);

  // The code repo, the brain repo and the hub all changed; the fixture hub still validates.
  expect(existsSync(join(world.projectsRoot, "SheepDream", "AGENTS.md"))).toBe(true);
  expect(readFileSync(join(ghRemotes, "gh.log"), "utf8")).toContain('"--private"');
  expect(sh(join(world.hub, "SheepDream"), "log", "-1", "--format=%s")).toContain("Sheep Dream");
  expect(readFileSync(join(world.hub, "brain.repos.json"), "utf8")).toContain("brain-sheep-dream");
  expect(sh(world.hub, "log", "-1", "--format=%s").trim()).toBe("Add Sheep Dream to the hub");
  const validate = await win.evaluate(() => window.office.invoke("vault.health"));
  expect(validate.validate).toMatchObject({ ran: true, ok: true });

  // The project is in Office and an agent session started in its folder.
  await win.getByTestId("spawn-open").click();
  await expect(win.getByTestId("project-page")).toContainText("Sheep Dream");
  const sessions = await win.evaluate(() =>
    window.office.invoke("sessions.list", { projectId: "sheep-dream" }),
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.cwd).toBe(join(world.projectsRoot, "SheepDream"));
  await app.close();
});

test("a public repo cannot be created without its own explicit checkbox", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-explore").click();
  await pick(win, "explore-provider", { label: "Fake agent" });
  await win.getByTestId("explore-start").click();
  await expect(win.getByTestId("explore-row")).toHaveCount(1);
  await win.getByTestId("make-project").click();
  await win.getByTestId("spawn-name").fill("Open Thing");
  await pick(win, "spawn-visibility", "public");
  await win.getByTestId("spawn-review").click();
  await expect(win.getByTestId("spawn-steps")).toContainText("--public");
  await expect(win.getByTestId("spawn-run")).toBeDisabled();
  await win.getByRole("button", { name: "Back" }).click();
  await win.getByTestId("spawn-public-ok").check();
  await win.getByTestId("spawn-review").click();
  await expect(win.getByTestId("spawn-run")).toBeEnabled();
  expect(existsSync(join(world.projectsRoot, "OpenThing"))).toBe(false);
  await app.close();
});
