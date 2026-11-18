import { expect, test } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, repoRoot } from "./helpers";

test("the sample channel module is off until enabled with a warning, then receives a notification", async () => {
  const { app, data } = await launch({ world: true, fakeTools: true });
  mkdirSync(join(data, "modules"), { recursive: true });
  cpSync(
    join(repoRoot, "examples/modules/sample-channel"),
    join(data, "modules", "sample-channel"),
    { recursive: true },
  );
  const win = await app.firstWindow();
  await win.getByTestId("rail-setup").click();
  await win.reload();
  await win.getByTestId("rail-setup").click();

  const row = win.getByTestId("module-row").filter({ hasText: "sample-channel" });
  await expect(row).toContainText("channel");
  await expect(row).not.toContainText("running");
  await row.getByTestId("module-enable").click();
  await expect(win.getByTestId("module-warning")).toContainText(
    "full access to your files and accounts",
  );
  await win.getByTestId("module-confirm").click();
  await expect(row).toContainText("running");

  // An urgent notification (an agent that needs the owner) reaches the module's channel.
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Needy",
    }),
  );
  // The page's CSP blocks fetch to localhost, so the hook POST comes from the test process.
  const post = await fetch("http://127.0.0.1:47999/hook/claude", {
    method: "POST",
    headers: { authorization: "Bearer e2e-token", "content-type": "application/json" },
    body: JSON.stringify({
      session_id: session.id,
      hook_event_name: "Notification",
      message: "please look",
    }),
  });
  expect(post.status).toBe(200);
  const log = join(data, "modules", "sample-channel", "data", "received.log");
  await expect
    .poll(() => existsSync(log) && readFileSync(log, "utf8"), { timeout: 15000 })
    .toContain("agent.needs-you\tNeedy needs you");
  await app.close();
});
