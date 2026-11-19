import { expect, test, type Page } from "@playwright/test";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "../fixtures/repos/make";
import { launch } from "./helpers";

// M12.4 (Simplify 2.5): every health item has one action: a fix Office makes itself (commit, discard, pull, push, sync), or a session to fix it.

/** The fake hub tool prints this instead of its own status, so the hub can look uncommitted without it being a file of the brain. */
const HUB_STATUS = `${".".padEnd(26)} 2026-11-18  1 uncommitted\nAhead/behind counts use the last fetch; \`sync\` refreshes them.\n`;

/** Files that only steer the fake tools are ignored by git, so they are never part of what a commit takes. */
function steer(hub: string, file: string, text: string): void {
  appendFileSync(join(hub, ".git", "info", "exclude"), `\n${file}\n`);
  writeFileSync(join(hub, file), text);
}

/** The background check runs after a change; Sync all runs it now. */
async function recheck(win: Page): Promise<void> {
  await win.evaluate(() => window.office.invoke("git.syncAll"));
}

test("an uncommitted brain file is reviewed with its diff and committed, or discarded after asking", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  const index = join(world.hub, "_index.md");
  const original = readFileSync(index, "utf8");
  steer(world.hub, "hub-status.txt", HUB_STATUS);
  appendFileSync(index, "\nA new line of the owner.\n");
  await recheck(win);

  await win.getByTestId("rail-brain").click();
  const repo = win.locator('[data-testid="health-repo"][data-repo="."]');
  await expect(repo).toContainText("1 uncommitted", { timeout: 30000 });
  await repo.getByTestId("health-review").click();

  // The file and its change are shown before anything is taken.
  await expect(win.getByTestId("health-files")).toContainText("_index.md");
  await expect(win.getByTestId("health-files")).toContainText("A new line of the owner.");

  // Discard asks first; keeping them changes nothing.
  await win.getByTestId("health-discard").click();
  await expect(win.getByTestId("health-discard-confirm")).toBeVisible();
  await win.getByRole("button", { name: "Keep them" }).click();
  expect(readFileSync(index, "utf8")).toContain("A new line of the owner.");
  await win.getByTestId("health-discard").click();
  await win.getByTestId("health-discard-yes").click();
  await expect(win.getByTestId("health-changes")).toHaveCount(0);
  await expect.poll(() => readFileSync(index, "utf8")).toBe(original);

  // The same again, committed this time.
  appendFileSync(index, "\nAnother line.\n");
  await recheck(win);
  await repo.getByTestId("health-review").click();
  await win.getByTestId("health-message").fill("Add the owner's line");
  await win.getByTestId("health-commit").click();
  await expect(win.getByTestId("health-changes")).toHaveCount(0);
  expect(sh(world.hub, "log", "-1", "--format=%s").trim()).toBe("Add the owner's line");
  expect(sh(world.hub, "status", "--porcelain").trim()).toBe("");
  await app.close();
});

test("a problem with no fix starts a session with the problem as its brief and its goal filled in", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  steer(world.hub, "FAIL_VALIDATE", "1");
  await recheck(win);
  await win.getByTestId("rail-brain").click();
  const error = win.locator('[data-testid="health-problem"][data-level="error"]');
  await expect(error).toContainText("broken link", { timeout: 30000 });
  // The wiki syntax is shown as words, not brackets.
  await expect(error).not.toContainText("[[");
  await expect(win.getByTestId("health-summary")).toContainText("Checks fail. 1 error, 1 warning");
  // The tool's own words are behind Show details, not on screen.
  await expect(win.getByTestId("brain")).not.toContainText("0 external links");
  await win.getByTestId("health-details").click();
  await expect(win.getByTestId("health-output")).toContainText("hub: 6 files");

  await error.getByTestId("health-session").click();
  await expect(win.getByTestId("start-agent-dialog")).toBeVisible();
  await expect(win.getByTestId("agent-goal")).toHaveValue(
    "Fix: Alpha/OpenItems.md: broken link Alpha/Missing",
  );
  await expect(win.getByTestId("agent-prompt")).toHaveValue(/broken link \[\[Alpha\/Missing\]\]/);
  // It starts in the brain repo that holds the problem.
  await expect(win.getByTestId("agent-folder")).toContainText("Alpha");
  await win.getByTestId("mode-provider").check();
  await win.getByTestId("agent-start").click();
  await expect(win.getByTestId("session-goal").first()).toHaveText(
    "Fix: Alpha/OpenItems.md: broken link Alpha/Missing",
  );
  await app.close();
});

test("an open content-audit entry is formatted text with a working link, and offers a session to fix", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  writeFileSync(
    join(world.hub, "Alpha", "_ContentAudit.md"),
    "# Alpha: content audit\n\n## Currently open\n\n- Alpha pricing notes disagree, see [[Alpha/Overview#Positioning and vision]]\n",
  );
  const win = await app.firstWindow();
  await win.getByTestId("rail-brain").click();
  const entry = win.getByTestId("audit-entry").first();
  await expect(entry).toContainText("Alpha pricing notes disagree", { timeout: 30000 });
  await expect(entry).not.toContainText("[[");
  await entry.getByTestId("wiki-link").click();
  await expect(win.getByTestId("project-page")).toBeVisible();
  await expect(win.getByTestId("note-source")).toContainText("Alpha/Overview.md");
  await app.close();
});

test("a project that is out of sync is fixed with Sync from Home and from Git", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  // The Alpha code repo gets a commit the remote does not have.
  const alpha = world.code["alpha"];
  if (!alpha) throw new Error("no alpha");
  writeFileSync(join(alpha.work, "sync.txt"), "x\n");
  sh(alpha.work, "add", "-A");
  sh(alpha.work, "commit", "-q", "-m", "Local work");
  await win.evaluate(() => window.office.invoke("projects.refresh", {}));
  const item = win.getByTestId("health-out-of-sync").filter({ hasText: "Alpha" });
  await expect(item).toContainText("1 to push", { timeout: 30000 });
  await item.getByTestId("health-sync").click();
  await expect(item).toHaveCount(0, { timeout: 30000 });
  rmSync(join(alpha.work, "sync.txt"), { force: true });
  await app.close();
});
