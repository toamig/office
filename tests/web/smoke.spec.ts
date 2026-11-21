import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("the web interface starts against the host and shows the rail", async () => {
  const { app, page } = await launch({ world: true });
  await expect(page.getByTestId("rail")).toBeVisible();
  await expect(page.getByTestId("rail")).toContainText("Projects");
  await expect(page.getByTestId("home")).toBeVisible();
  await app.close();
});
