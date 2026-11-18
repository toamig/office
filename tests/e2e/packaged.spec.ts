import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { launch, packagedExe } from "./helpers";

// Runs only after `npm run dist` has produced the unpacked app. It proves the packaged build, with
// its native modules unpacked, starts and works against the fixture world.
test.skip(!existsSync(packagedExe), "run `npm run dist` first");

test("the packaged app shows the fixture workspace and opens the database", async () => {
  const { app } = await launch({ world: true, packaged: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("waiting-item")).toHaveCount(2);
  const counts = await win.evaluate(() => window.office.invoke("notifications.counts"));
  expect(counts).toEqual({ unread: 0, urgentUnread: 0 });
  await app.close();
});
