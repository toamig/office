import { _electron as electron, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("app launches and shows the rail", async () => {
  const app = await electron.launch({ args: [resolve(__dirname, "../..")] });
  const win = await app.firstWindow();
  await expect(win.getByTestId("rail")).toBeVisible();
  await expect(win.getByTestId("rail")).toContainText("Projects");
  await app.close();
});
