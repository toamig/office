import { expect, test } from "@playwright/test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "../fixtures/repos/make";
import { launch, terminalText } from "./helpers";

test("branches: create, a dirty switch is refused with a stash offer, and the stash works", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const alpha = world.code["alpha"]?.work as string;
  const win = await app.firstWindow();
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();

  await win.getByTestId("new-branch-name").fill("feature-x");
  await win.getByTestId("create-branch").click();
  await expect(win.getByTestId("branch-row").filter({ hasText: "feature-x" })).toContainText(
    "current",
  );
  expect(sh(alpha, "branch", "--show-current").trim()).toBe("feature-x");

  writeFileSync(join(alpha, "README.md"), "# dirty\n");
  await win
    .getByTestId("branch-row")
    .filter({ hasText: "main" })
    .first()
    .getByTestId("switch-branch")
    .click();
  await expect(win.getByTestId("stash-offer")).toBeVisible();
  expect(sh(alpha, "branch", "--show-current").trim()).toBe("feature-x");
  await win.getByTestId("stash-switch").click();
  await expect(win.getByTestId("branch-row").filter({ hasText: "main" }).first()).toContainText(
    "current",
  );
  expect(sh(alpha, "stash", "list")).toContain("office: before switching to main");
  await app.close();
});

test("worktrees: make one, open an agent in it, see it in the switcher and remove it", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const alpha = world.code["alpha"]?.work as string;
  const win = await app.firstWindow();
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("git-tab-worktrees").click();

  await win.getByTestId("new-worktree-name").fill("task one");
  await win.getByTestId("create-worktree").click();
  const row = win.getByTestId("worktree-row").filter({ hasText: "office/task-one" });
  await expect(row).toContainText("office");
  const wtPath = join(alpha, ".office", "worktrees", "task-one");
  expect(existsSync(join(wtPath, "README.md"))).toBe(true);

  await row.getByTestId("agent-in-worktree").click();
  await expect(win.getByTestId("agent-folder")).toHaveValue(wtPath);
  await win.getByTestId("mode-provider").check();
  await win.getByTestId("agent-provider").selectOption({ label: "Fake agent" });
  await win.getByTestId("agent-start").click();
  await expect(win.getByTestId("session-row").first()).toContainText("office/task-one", {
    timeout: 20000,
  });

  await win.keyboard.press("Control+k");
  await win.getByLabel("Quick switcher").fill("task-one");
  await expect(
    win.getByTestId("switcher-item").filter({ hasText: "worktree" }).first(),
  ).toBeVisible();
  await win.keyboard.press("Escape");

  // A running process holds its folder open on Windows, so the agent is stopped before the removal.
  await win.getByTestId("stop-session").click();
  await expect(win.getByTestId("session-status").first()).toContainText("exited");
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("git-tab-worktrees").click();
  await win
    .getByTestId("worktree-row")
    .filter({ hasText: "office/task-one" })
    .getByTestId("remove-worktree")
    .click();
  await expect(win.getByTestId("worktree-row").filter({ hasText: "office/task-one" })).toHaveCount(
    0,
  );
  expect(existsSync(wtPath)).toBe(false);
  await app.close();
});

test("diff review: two line comments go to the agent that owns the worktree as one message", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  const made = await win.evaluate(() =>
    window.office.invoke("worktrees.create", { projectId: "alpha", name: "review task" }),
  );
  writeFileSync(join(made.path, "README.md"), "# alpha\nsecond line\n");
  writeFileSync(join(made.path, "fresh.txt"), "brand new file\n");
  await win.evaluate(
    (cwd) =>
      window.office.invoke("sessions.start", {
        providerId: "fake",
        projectId: "alpha",
        cwd,
        title: "Reviewed",
      }),
    made.path,
  );

  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("git-tab-changes").click();
  await win.getByTestId("diff-dir").selectOption({ label: "Worktree: office/review-task" });
  await expect(win.getByTestId("diff-file")).toHaveCount(2);

  await win.getByTestId("diff-file").filter({ hasText: "README.md" }).click();
  await win
    .getByTestId("diff-line")
    .filter({ hasText: "second line" })
    .getByTestId("comment-line")
    .click();
  await win.getByTestId("comment-text").fill("rename this line");
  await win.getByTestId("comment-save").click();
  await win.getByTestId("diff-file").filter({ hasText: "fresh.txt" }).click();
  await win
    .getByTestId("diff-line")
    .filter({ hasText: "brand new file" })
    .getByTestId("comment-line")
    .click();
  await win.getByTestId("comment-text").fill("why is this here");
  await win.getByTestId("comment-save").click();
  await expect(win.getByTestId("comment-item")).toHaveCount(2);

  await win.getByTestId("send-to-agent").click();
  await expect(win.getByTestId("review-sent")).toContainText(
    "Sent your comments to the running agent",
  );

  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Reviewed" }).click();
  await expect.poll(() => terminalText(win)).toContain("echo: README.md:2: rename this line");
  await expect.poll(() => terminalText(win)).toContain("echo: fresh.txt:1: why is this here");
  await app.close();
});
