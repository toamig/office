import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("the web interface starts against the host and shows the rail", async () => {
  const { app, page } = await launch({ world: true });
  await expect(page.getByTestId("rail")).toBeVisible();
  await expect(page.getByTestId("rail")).toContainText("Projects");
  await expect(page.getByTestId("home")).toBeVisible();
  await app.close();
});

test("one IPC call round-trips through the socket", async () => {
  const { app, page } = await launch();
  const pong = await page.evaluate(() => window.office.invoke("app.ping", { text: "hi" }));
  expect(pong.text).toBe("hi");
  await app.close();
});
