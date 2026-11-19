import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

// One check per view: it opens from the rail and draws its root.
const VIEWS = [
  ["home", "home"],
  ["projects", "projects"],
  ["agents", "agents"],
  ["git", "git"],
  ["board", "board"],
  ["brain", "brain"],
  ["inbox", "inbox"],
  ["explore", "explore"],
  ["setup", "setup"],
] as const;

for (const [rail, root] of VIEWS) {
  test(`the ${rail} view opens and draws`, async () => {
    const { app, page } = await launch({ world: true, fakeTools: true });
    await page.getByTestId(`rail-${rail}`).click();
    await expect(page.getByTestId(root)).toBeVisible();
    // Every view says in one line what it is for, under its title, and the title is not repeated in the top bar.
    const purpose = page.getByTestId(root).locator(".page-sub").first();
    await expect(purpose).toBeVisible();
    expect(((await purpose.innerText()).match(/[.]/g) ?? []).length).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("topbar-title")).toHaveCount(0);
    await app.close();
  });
}
