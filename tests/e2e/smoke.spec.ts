import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("app launches and shows the rail", async () => {
  const { app } = await launch({ world: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("rail")).toBeVisible();
  await expect(win.getByTestId("rail")).toContainText("Projects");
  await app.close();
});
