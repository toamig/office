import { expect, test } from "@playwright/test";
import { commit, sh } from "../fixtures/repos/make";
import { launch } from "./helpers";

// M12.5 (Simplify 2.6): the Git desk's main view is a vertical branch graph.

test("the graph shows lanes, a fork, a join, worktree marks and where you are", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const alpha = world.code["alpha"]?.work as string;
  // main and feature-b both start from the first commit; feature-a is merged into main with a merge commit.
  sh(alpha, "checkout", "-q", "-b", "feature-b");
  commit(alpha, "b.txt", "b\n", "Work on feature-b");
  sh(alpha, "checkout", "-q", "main");
  sh(alpha, "checkout", "-q", "-b", "feature-a");
  commit(alpha, "a.txt", "a\n", "Work on feature-a");
  sh(alpha, "checkout", "-q", "main");
  commit(alpha, "m.txt", "m\n", "Work on main");
  sh(alpha, "merge", "-q", "--no-ff", "feature-a", "-m", "Merge feature-a");
  sh(alpha, "tag", "v1");

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  // Two worktrees, each on a branch of its own.
  for (const name of ["wt one", "wt two"])
    await win.evaluate(
      (n) => window.office.invoke("worktrees.create", { projectId: "alpha", name: n }),
      name,
    );
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();

  // The graph is the main view: the merge commit carries main and the tag.
  const rows = win.getByTestId("graph-row");
  const merge = rows.filter({ hasText: "Merge feature-a" });
  await expect(merge).toHaveCount(1, { timeout: 30000 });
  await expect(merge.locator('[data-branch="main"]')).toBeVisible();
  await expect(merge).toContainText("v1");
  // HEAD is marked once, at the branch that is checked out.
  await expect(win.getByTestId("graph-here")).toHaveCount(1);
  await expect(rows.filter({ has: win.getByTestId("graph-here") })).toContainText("main");
  // A join (the merge commit leaves two lines) and a fork (two lanes end at the commit they started from).
  await expect(win.locator('[data-join="true"]').first()).toBeAttached();
  await expect(win.locator('[data-fork="true"]').first()).toBeAttached();
  // Each branch is a lane in its own colour: more than one colour is drawn.
  const colours = await win
    .locator(".graph-lines path, .graph-lines line")
    .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("class")))]);
  expect(colours.length).toBeGreaterThan(1);
  // Both worktrees are marked on their branch.
  await expect(win.getByTestId("graph-worktree")).toHaveCount(2);
  await expect(
    win.locator('[data-branch="office/wt-one"] [data-testid="graph-worktree"]'),
  ).toHaveCount(1);

  // Clicking a commit selects it and shows its details in the inspector.
  await rows.nth(1).click();
  await expect(win.getByTestId("commit-inspector")).toContainText("Commit");

  // A branch label offers what can be done with it; a merged branch can be deleted.
  const label = win.locator('[data-testid="graph-branch"][data-branch="feature-a"]');
  await label.getByRole("button").first().click();
  await expect(win.getByTestId("branch-delete")).toBeVisible();
  await expect(win.getByTestId("branch-switch")).toBeVisible();
  await win.getByTestId("branch-switch").click();
  await expect(win.getByTestId("graph-here")).toHaveCount(1);
  await expect(rows.filter({ has: win.getByTestId("graph-here") })).toContainText("feature-a", {
    timeout: 20000,
  });

  // The branch list is a filter: it finds branches, and With a worktree narrows it.
  await win.getByTestId("graph-find").fill("feature-b");
  await expect(win.getByTestId("graph-filter-branch")).toHaveCount(1);
  await win.getByTestId("graph-find").fill("");
  await win.getByTestId("graph-only-worktrees").check();
  await expect(win.getByTestId("graph-filter-branch")).toHaveCount(2);
  await app.close();
});

test("a long history is drawn in windows, loads more on request, and scrolls smoothly", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const alpha = world.code["alpha"]?.work as string;
  // 330 commits on top of the fixture's own.
  for (let i = 0; i < 330; i++)
    sh(alpha, "commit", "-q", "--allow-empty", "-m", `Commit ${String(i).padStart(3, "0")}`);

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  const rows = win.getByTestId("graph-row");
  await expect(rows.first()).toContainText("Commit 329", { timeout: 30000 });
  // Only the rows near the screen are in the page, though 300 are loaded.
  const drawn = await rows.count();
  expect(drawn).toBeGreaterThan(5);
  expect(drawn).toBeLessThan(120);
  // The oldest of them is reached by scrolling, and more can be asked for.
  await expect(win.getByTestId("graph-more")).toBeVisible();
  const frame = await win.getByTestId("graph-main").evaluate(async (el) => {
    const times: number[] = [];
    let last = performance.now();
    const end = el.scrollHeight;
    await new Promise<void>((done) => {
      const step = (): void => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        el.scrollTop += (end - el.clientHeight) / 90;
        if (el.scrollTop + el.clientHeight >= end - 2 || times.length > 240) done();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return times.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, times.length - 1);
  });
  console.log(`graph scroll: ${frame.toFixed(1)} ms per frame`);
  expect(frame).toBeLessThan(34);
  await win.getByTestId("graph-more").click();
  await expect(win.getByTestId("graph-row").last()).toBeAttached();
  await app.close();
});
