import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { sh } from "../fixtures/repos/make";
import { launch } from "./helpers";

// The M3 milestone check on fixtures: a worktree, a fake builder working in it, its diff reviewed with
// a comment, a commit of the chosen file, and a push to the bare remote.
test("worktree, fake builder, review with a comment, commit and push to the bare remote", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const alpha = world.code["alpha"];
  if (!alpha) throw new Error("no alpha");
  const win = await app.firstWindow();

  // A worktree for the task, and a fake builder started in it.
  const made = await win.evaluate(() =>
    window.office.invoke("worktrees.create", { projectId: "alpha", name: "review flow" }),
  );
  await win.evaluate(
    (cwd) =>
      window.office.invoke("sessions.start", {
        providerId: "fake",
        projectId: "alpha",
        cwd,
        title: "Builder",
      }),
    made.path,
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Builder" }).click();
  await expect(win.locator(".xterm-rows")).toContainText("fake-claude ready");
  await win.locator(".xterm").click();
  await win.keyboard.type("build");
  await win.keyboard.press("Enter");
  await expect(win.locator(".xterm-rows")).toContainText("built built-");

  // Review its diff and leave a comment for the builder.
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("git-tab-changes").click();
  await win.getByTestId("diff-dir").selectOption({ label: "Worktree: office/review-flow" });
  await expect(win.getByTestId("diff-file")).toHaveCount(1);
  await win
    .getByTestId("diff-line")
    .filter({ hasText: "built by the fake builder" })
    .getByTestId("comment-line")
    .click();
  await win.getByTestId("comment-text").fill("add a test for this");
  await win.getByTestId("comment-save").click();
  await win.getByTestId("send-to-agent").click();
  await expect(win.getByTestId("review-sent")).toContainText("Sent your comments");

  // Commit only that file, and push: the first push sets the upstream on the bare remote.
  await win.getByTestId("git-tab-commit").click();
  await win.getByTestId("commit-dir").selectOption({ label: "Worktree: office/review-flow" });
  await expect(win.getByTestId("commit-file")).toHaveCount(1);
  await win.getByTestId("commit-message").fill("Builder: add the built file");
  await win.getByTestId("commit-push").click();
  await expect(win.getByTestId("commit-note")).toContainText("pushed");

  expect(sh(made.path, "log", "-1", "--format=%s").trim()).toBe("Builder: add the built file");
  expect(sh(alpha.bare, "log", "office/review-flow", "-1", "--format=%s").trim()).toBe(
    "Builder: add the built file",
  );
  expect(sh(join(alpha.work), "branch", "--show-current").trim()).toBe("main");
  await app.close();
});

test("the PRs and CI tab lists pull requests and runs for a repo on GitHub", async () => {
  const { app, world } = await launch({
    world: true,
    fakeTools: true,
    env: {
      FAKE_GH_PRS: join(__dirname, "../fixtures/gh/pr-list.json"),
      FAKE_GH_RUNS: join(__dirname, "../fixtures/gh/run-list.json"),
    },
  });
  if (!world) throw new Error("no world");
  sh(
    world.code["beta"]?.work as string,
    "remote",
    "set-url",
    "origin",
    "git@github.com:fixture-owner/beta.git",
  );
  const win = await app.firstWindow();
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Beta" }).click();
  await win.getByTestId("git-tab-prs").click();
  await expect(win.getByTestId("pr-row")).toHaveCount(3);
  await expect(win.getByTestId("pr-row").first()).toContainText("Add the sheep counter");
  await expect(win.getByTestId("pr-row").first()).toContainText("review required");
  await expect(win.getByTestId("run-row")).toHaveCount(3);
  await expect(win.getByTestId("run-row").first()).toContainText("failure");

  // A repo that is not on GitHub says so instead of calling gh.
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("git-tab-prs").click();
  await expect(win.getByTestId("prs-panel")).toContainText("not on GitHub");
  await app.close();
});
