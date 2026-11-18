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

test("the packaged app runs a terminal session and finds the relay script in its resources", async () => {
  const { app } = await launch({ world: true, fakeTools: true, packaged: true });
  const win = await app.firstWindow();
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Packaged",
    }),
  );
  await expect
    .poll(
      async () =>
        (await win.evaluate((id) => window.office.invoke("sessions.history", { id }), session.id))
          .data,
      { timeout: 30000 },
    )
    .toContain("fake-claude ready");

  const preview = await win.evaluate(() =>
    window.office.invoke("hooks.preview", { target: "claude", action: "install" }),
  );
  expect(preview.diff).toMatch(/resources\/relay\/office-relay\.mjs/);
  const update = await win.evaluate(() => window.office.invoke("app.update.status"));
  expect(update.enabled).toBe(false); // test data is in use, so no update check runs
  await app.close();
});
