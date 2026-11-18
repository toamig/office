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
    await app.close();
  });
}
