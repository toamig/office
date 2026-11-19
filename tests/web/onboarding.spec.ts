import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./helpers";

const sh = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

function repo(dir: string, files: Record<string, string> = { "README.md": "# repo\n" }): string {
  mkdirSync(dir, { recursive: true });
  sh(dir, "init", "-q", "-b", "main");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "first");
  return dir;
}

test("Start a new brain from an empty app-data folder: a committed repo, an empty workspace, and no GitHub repo unless ticked", async () => {
  const { app, base, data } = await launch({ world: "unconfigured", fakeTools: true });
  const win = await app.firstWindow();
  // Starting a new brain is the first choice.
  await expect(win.getByTestId("mode-new")).toBeChecked();
  const folder = join(base, "MyBrain");
  await win.getByTestId("brain-folder").fill(folder);
  await win.getByTestId("brain-create").click();
  await expect(win.getByTestId("brain-created")).toContainText("Office/workspace.json");
  await expect(win.getByTestId("welcome-continue")).toBeEnabled();

  expect(sh(folder, "log", "--format=%s").trim()).toBe("Start the brain");
  expect(sh(folder, "status", "--porcelain").trim()).toBe("");
  for (const file of ["README.md", "AGENTS.md", "Projects/README.md", "Office/workspace.json"])
    expect(existsSync(join(folder, file)), file).toBe(true);
  const config = JSON.parse(readFileSync(join(folder, "Office", "workspace.json"), "utf8"));
  expect(config.projects).toEqual([]);
  expect(config.vault.kind).toBe("folder");
  expect(JSON.parse(readFileSync(join(data, "settings.json"), "utf8")).workspaceRoot).toBe(folder);
  // No GitHub repo was asked for, so gh was never asked to make one.
  const ghLog = join(base, "gh-remotes", "gh.log");
  expect(existsSync(ghLog) ? readFileSync(ghLog, "utf8") : "").not.toContain("repo");
  await app.close();
});

test("a new brain with the GitHub box ticked creates and pushes a private repo", async () => {
  const { app, base } = await launch({ world: "unconfigured", fakeTools: true });
  const win = await app.firstWindow();
  const folder = join(base, "PushedBrain");
  await win.getByTestId("brain-folder").fill(folder);
  await win.getByTestId("brain-github").check();
  await win.getByTestId("brain-repo-name").fill("my-notes");
  await win.getByTestId("brain-create").click();
  await expect(win.getByTestId("brain-created")).toContainText("my-notes");
  const log = readFileSync(join(base, "gh-remotes", "gh.log"), "utf8");
  expect(log).toContain("my-notes");
  expect(log).toContain("--private");
  expect(log).toContain("--push");
  expect(sh(folder, "remote").trim()).toBe("origin");
  await app.close();
});

test("a new brain refuses a folder that already has files", async () => {
  const { app, base } = await launch({ world: "unconfigured" });
  const win = await app.firstWindow();
  const folder = join(base, "Busy");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "x.txt"), "x");
  await win.getByTestId("brain-folder").fill(folder);
  await win.getByTestId("brain-create").click();
  await expect(win.getByTestId("wizard-error")).toContainText("already has files");
  await app.close();
});

test("Add projects lists only new repos, adds notes in a hub, matches existing notes, and Projects shows them", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const root = world.projectsRoot;
  // Four more folders: one is a worktree of a known project, one has notes already, two are new.
  repo(join(root, "Gamma"), { "package.json": '{"name":"gamma-app"}' });
  repo(join(root, "Games", "Delta"));
  repo(join(root, "Omega"));
  // Notes for it already exist in the brain.
  mkdirSync(join(world.hub, "Omega"), { recursive: true });
  writeFileSync(join(world.hub, "Omega", "Overview.md"), "# Omega\n");
  sh(join(root, "Alpha"), "worktree", "add", "-q", "-b", "wt", join(root, "Alpha-wt"));
  const win = await app.firstWindow();

  await win.getByTestId("rail-projects").click();
  await win.getByTestId("add-projects-open").click();
  const rows = win.getByTestId("scan-row");
  // Alpha and Beta are known and the worktree is skipped: three are listed.
  await expect(rows).toHaveCount(3);
  await expect(win.getByTestId("scan-list")).not.toContainText("Alpha-wt");
  await expect(rows.filter({ hasText: "Omega" })).toContainText("notes found");
  await expect(rows.filter({ has: win.locator('input[value="gamma-app"]') })).toHaveCount(1);

  // Pick Delta (a folder in an existing notes repo) and Omega (the notes found), then see what will happen.
  const delta = rows.filter({ hasText: "Delta" });
  await delta.getByTestId("scan-pick").check();
  await delta.getByTestId("scan-group").fill("Games");
  await delta.getByTestId("scan-notes").click();
  await win.getByTestId("select-menu").getByText("Folder in Alpha", { exact: true }).click();
  await rows.filter({ hasText: "Omega" }).getByTestId("scan-pick").check();
  const plan = win.getByTestId("add-plan");
  await expect(plan).toContainText("Delta");
  await expect(plan).toContainText("Overview and OpenItems in Alpha");
  await expect(plan).toContainText("uses the notes in Omega");
  await win.getByTestId("add-confirm").click();
  await expect(win.getByTestId("add-report")).toContainText("Added");
  await expect(win.getByTestId("add-report")).not.toContainText("Failed");

  // One commit per project, notes in the folder of the notes repo, and the link points at the existing notes.
  const config = JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  const byName = Object.fromEntries(config.projects.map((p: { name: string }) => [p.name, p]));
  expect(byName["Delta"]).toMatchObject({
    path: "Games/Delta",
    vault: "Alpha/Delta",
    group: "Games",
  });
  expect(byName["Omega"]).toMatchObject({ vault: "Omega" });
  expect(existsSync(join(world.hub, "Alpha", "Delta", "OpenItems.md"))).toBe(true);
  expect(sh(join(world.hub, "Alpha"), "log", "-1", "--format=%s").trim()).toBe(
    "Add notes for Delta",
  );
  const hubLog = sh(join(world.hub, "Office"), "log", "-2", "--format=%s").trim().split("\n");
  expect(hubLog).toEqual(["Add project Omega", "Add project Delta"]);

  await win.getByTestId("add-projects-close").click();
  await expect(win.getByTestId("project-card")).toHaveCount(4);
  await expect(win.getByTestId("projects")).not.toContainText("folder missing");

  // A new notes repo for the last one, through the fake gh.
  await win.getByTestId("add-projects-open").click();
  const gamma = win.getByTestId("scan-row").filter({ hasText: "gamma" });
  await gamma.getByTestId("scan-pick").check();
  await expect(win.getByTestId("add-plan")).toContainText("a new notes repo");
  await win.getByTestId("add-confirm").click();
  await expect(win.getByTestId("add-report")).toContainText("Added", { timeout: 60000 });
  const hubConfig = JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  expect(hubConfig.projects.find((p: { name: string }) => p.name === "gamma-app").vault).toBe(
    "GammaApp",
  );
  expect(existsSync(join(world.hub, "GammaApp", "Overview.md"))).toBe(true);
  await app.close();
});

test("the agent pointer: shown first, only its file committed, nothing outside the markers touched, and Remove puts it back", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const alpha = world.code["alpha"];
  if (!alpha) throw new Error("no alpha");
  const mine = "# Alpha rules\n\nKeep this exactly.\n";
  writeFileSync(join(alpha.work, "AGENTS.md"), mine);
  sh(alpha.work, "add", "-A");
  sh(alpha.work, "commit", "-q", "-m", "rules");
  const win = await app.firstWindow();

  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("project-pointer-add").click();
  await expect(win.getByTestId("pointer-text")).toContainText("<!-- office:begin -->");
  await expect(win.getByTestId("pointer-text")).toContainText("Overview.md");
  // Nothing is written until it is confirmed.
  expect(readFileSync(join(alpha.work, "AGENTS.md"), "utf8")).toBe(mine);
  await win.getByTestId("pointer-confirm").click();
  await expect(win.getByTestId("pointer-report")).toContainText("AGENTS.md");
  await win.getByTestId("pointer-close").click();

  const installed = readFileSync(join(alpha.work, "AGENTS.md"), "utf8");
  expect(installed.startsWith(mine)).toBe(true);
  expect(installed).toContain("<!-- office:end -->");
  expect(sh(alpha.work, "log", "-1", "--format=%s").trim()).toBe("Add the Office pointer");
  expect(sh(alpha.work, "show", "--name-only", "--format=", "HEAD").trim()).toBe("AGENTS.md");
  // Not pushed: the repo's own earlier commit and the pointer's are both still local.
  expect(sh(alpha.work, "status", "-sb").split("\n")[0]).toContain("ahead 2");

  await win.getByTestId("project-pointer-remove").click();
  await win.getByTestId("pointer-confirm").click();
  await win.getByTestId("pointer-close").click();
  expect(readFileSync(join(alpha.work, "AGENTS.md"), "utf8")).toBe(mine);
  await app.close();
});

test("Remove from Office drops only the workspace entry", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const beta = world.code["beta"];
  if (!beta) throw new Error("no beta");
  const win = await app.firstWindow();
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Beta" }).click();
  await win.getByTestId("project-remove").click();
  await expect(win.getByTestId("remove-confirm")).toContainText("Its notes, its code");
  await win.getByTestId("remove-yes").click();
  await expect(win.getByTestId("projects")).toBeVisible();
  await expect(win.getByTestId("project-card")).toHaveCount(1);
  const config = JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"));
  expect(config.projects.map((p: { id: string }) => p.id)).toEqual(["alpha"]);
  expect(existsSync(join(beta.work, "README.md"))).toBe(true);
  await app.close();
});
