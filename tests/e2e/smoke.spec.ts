import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("app launches and shows the rail", async () => {
  const { app } = await launch({ world: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("rail")).toBeVisible();
  await expect(win.getByTestId("rail")).toContainText("Projects");
  await app.close();
});

test("one IPC call round-trips through the contract", async () => {
  const { app } = await launch();
  const win = await app.firstWindow();
  const res = await win.evaluate(() => window.office.invoke("app.ping", { text: "hello" }));
  expect(res.text).toBe("hello");
  const bad = await win.evaluate(() =>
    window.office.invoke("app.ping", { text: 5 } as never).then(
      () => "no error",
      (e: Error) => e.message,
    ),
  );
  expect(bad).toContain("Invalid request");
  const ws = await win.evaluate(() => window.office.invoke("workspace.get"));
  expect(ws.configured).toBe(false);
  await app.close();
});
