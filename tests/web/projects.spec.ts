import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("a project opens", async () => {
  const { app, page } = await launch({ world: true });
  try {
    await page.getByTestId("rail-projects").click();
    await page.getByTestId("project-card").filter({ hasText: "Alpha" }).first().click();
    await expect(page.getByTestId("project-page")).toBeVisible();
  } finally {
    await app.close();
  }
});
