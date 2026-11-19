import { expect, test } from "@playwright/test";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./helpers";

test("the projects folder step says where the list comes from, suggests the folder, asks before an empty one, and reports what it found", async () => {
  const { app, world, base } = await launch({ world: "unconfigured", fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("setup-root").fill(world.hub);
  await win.getByTestId("setup-use-folder").click();
  await win.getByTestId("setup-use-workspace").click();
  await win.getByTestId("welcome-continue").click();

  // It says where the list comes from, and suggests the folder where most of the projects are.
  await expect(win.getByTestId("projects-total")).toContainText("Your workspace lists 2 projects");
  await expect(win.getByTestId("projects-suggestion")).toContainText("Found 2 of 2 projects");
  await expect(win.getByTestId("projects-suggestion")).toContainText(world.projectsRoot);

  // A folder with none of them is asked about before it is used.
  const empty = join(base, "empty-folder");
  mkdirSync(empty, { recursive: true });
  await win.getByTestId("setup-projects").fill(empty);
  await win.getByTestId("setup-projects").press("Enter");
  await expect(win.getByTestId("projects-none-found")).toContainText("None of your 2 projects");
  await expect(win.getByTestId("welcome-continue")).toBeDisabled();
  await win.getByTestId("projects-none-found").getByText("Choose another").click();

  // The right folder is saved on Enter, with what was found.
  await win.getByTestId("setup-projects").fill(world.projectsRoot);
  await win.getByTestId("setup-projects").press("Enter");
  await expect(win.getByTestId("projects-saved")).toContainText("Saved");
  await expect(win.getByTestId("projects-found")).toContainText("Found 2 of 2 projects");
  await expect(win.getByTestId("welcome-continue")).toBeEnabled();
  await app.close();
});

test("a typed folder that is not saved says so, Undo puts the saved one back, and leaving with one that was never accepted asks first", async () => {
  const { app, world, base } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-setup").click();
  const field = win.getByTestId("setup-projects");
  await expect(field).toHaveValue(world.projectsRoot);
  await expect(win.getByTestId("projects-found")).toContainText("Found 2 of 2 projects");

  // Typing without confirming shows it as unsaved, with Save and Undo; Undo puts the saved folder back.
  await field.fill(join(base, "somewhere"));
  await expect(win.getByTestId("projects-unsaved")).toContainText("Not saved yet");
  await win.getByTestId("projects-undo").click();
  await expect(field).toHaveValue(world.projectsRoot);
  await expect(win.getByTestId("projects-unsaved")).toHaveCount(0);

  // A folder holding none of the projects is asked about when the field is left; going to another page with that
  // question open asks too, and Stay keeps it.
  await field.fill(join(base, "somewhere"));
  await win.getByTestId("rail-home").click();
  await expect(win.getByTestId("leave-guard")).toBeVisible();
  await win.getByTestId("leave-stay").click();
  await expect(win.getByTestId("setup")).toBeVisible();
  await expect(win.getByTestId("projects-none-found")).toBeVisible();
  // Choosing another puts the saved folder back, and leaving is free again.
  await win.getByTestId("projects-none-found").getByText("Choose another").click();
  await expect(field).toHaveValue(world.projectsRoot);
  await win.getByTestId("rail-home").click();
  await expect(win.getByTestId("home")).toBeVisible();
  await app.close();
});

test("change the projects folder in Setup, restart, and Sync all uses the new folder", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const { world, base } = first;
  if (!world) throw new Error("no world");
  // A second projects folder that holds Alpha only.
  const other = join(base, "other-projects");
  mkdirSync(other, { recursive: true });
  const alpha = world.code["alpha"];
  if (!alpha) throw new Error("no alpha");
  cpSync(alpha.work, join(other, "Alpha"), { recursive: true });

  const win = await first.app.firstWindow();
  await win.getByTestId("rail-setup").click();
  await win.getByTestId("setup-projects").fill(other);
  await win.getByTestId("setup-projects").press("Enter");
  await expect(win.getByTestId("projects-saved")).toContainText("Saved");
  await expect(win.getByTestId("projects-found")).toContainText("Found 1 of 2 projects");
  await expect(win.getByTestId("projects-missing")).toContainText("Beta");
  expect(JSON.parse(readFileSync(join(first.data, "settings.json"), "utf8")).projectsRoot).toBe(
    other,
  );
  await first.app.close();

  // After a restart the new folder is still the one, and Sync all names what is missing.
  const second = await launch({ base, fakeTools: true });
  const page = await second.app.firstWindow();
  await page.getByTestId("sync-all").click();
  const report = page.getByTestId("sync-report");
  await expect(report).toBeVisible();
  const projects = report.getByTestId("sync-group-projects");
  await expect(projects.getByTestId("sync-row").filter({ hasText: "Beta" })).toContainText(
    "folder missing",
  );
  await expect(projects.getByTestId("sync-row").filter({ hasText: "Alpha" })).not.toContainText(
    "folder missing",
  );
  // The brain's own repos are their own group, and the hub has a name.
  await expect(report.getByTestId("sync-group-brain-notes")).toContainText("Brain hub");
  await second.app.close();
});

test("a project with a missing folder offers Change projects folder and Locate this folder, and a banner says when all are missing", async () => {
  const { app, world, base } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  // Every folder is missing under an empty projects folder.
  const empty = join(base, "nothing-here");
  mkdirSync(empty, { recursive: true });
  await win.getByTestId("rail-setup").click();
  await win.getByTestId("setup-projects").fill(empty);
  await win.getByTestId("setup-projects").press("Enter");
  await expect(win.getByTestId("projects-none-found")).toBeVisible();
  await win.getByTestId("projects-use-anyway").click();
  await expect(win.getByTestId("projects-saved")).toContainText("Found 0 of 2 projects");

  await win.getByTestId("rail-projects").click();
  await expect(win.getByTestId("all-folders-missing")).toContainText(
    "None of your project folders were found",
  );
  await expect(win.getByTestId("project-card")).toHaveCount(2);
  await expect(win.getByTestId("project-card").first()).toContainText("folder missing");

  // Locate this folder: the dialog's answer is scripted; the card finds its folder.
  await app.control("folder", { path: join(world.projectsRoot, "Alpha") });
  const alphaCard = win.getByTestId("project-card").filter({ hasText: "Alpha" });
  await alphaCard.getByTestId("locate-project").click();
  await expect(alphaCard).not.toContainText("folder missing");
  await expect(win.getByTestId("all-folders-missing")).toHaveCount(0);
  await expect(win.getByTestId("project-card").filter({ hasText: "Beta" })).toContainText(
    "folder missing",
  );

  // Change projects folder goes to Setup.
  await win
    .getByTestId("project-card")
    .filter({ hasText: "Beta" })
    .getByTestId("change-projects-folder")
    .click();
  await expect(win.getByTestId("setup")).toBeVisible();
  await app.close();
});
