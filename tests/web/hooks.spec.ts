import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, relayUrl, terminalText } from "./helpers";

test("a simulated hook POST moves a session to needs-you and raises an urgent notification", async () => {
  const { app, data } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Hooked",
    }),
  );

  const post = (token: string): Promise<number> =>
    fetch(`${relayUrl(data)}/hook/claude`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        session_id: session.id,
        hook_event_name: "Notification",
        message: "Claude needs your permission",
      }),
    }).then((r) => r.status);
  expect(await post("not-the-token")).toBe(401);
  expect(await post("e2e-token")).toBe(200);

  await win.getByTestId("rail-agents").click();
  await expect(win.getByTestId("session-status").first()).toContainText(/needs you/i);
  await win.getByTestId("rail-inbox").click();
  const note = win.getByTestId("notification");
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("Hooked needs you");
  await expect(note).toContainText("urgent");
  await app.close();
});

test("installing the hooks from Setup shows the exact diff, and a real hook run reaches the inbox", async () => {
  const { app, home } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();

  await win.getByTestId("rail-setup").click();
  await win.getByTestId("install-claude").click();
  await expect(win.getByTestId("hooks-consent")).toBeVisible();
  // The dialog leads with plain words; the exact change is behind a toggle.
  await expect(win.getByTestId("hooks-plain")).toContainText("every Claude Code session");
  await expect(win.getByTestId("hooks-plain")).toContainText("2 seconds");
  await expect(win.getByTestId("hooks-plain")).toContainText("Chat sessions");
  await expect(win.getByTestId("hooks-diff")).toHaveCount(0);
  await win.getByTestId("hooks-diff-toggle").click();
  await expect(win.getByTestId("hooks-diff")).toContainText("office-relay.mjs");
  // Nothing is written until the owner confirms.
  expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).not.toContain(
    "office-relay",
  );
  await win.getByTestId("hooks-confirm").click();
  // "not installed" contains "installed", so wait for the words that mean it is done.
  await expect(win.getByTestId("hooks-claude")).not.toContainText("not installed");
  await expect(win.getByTestId("hooks-message")).toBeVisible();
  expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toContain(
    "office-relay.mjs",
  );

  // The fake agent runs the installed hooks exactly as Claude Code would.
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Asker",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Asker" }).click();
  await expect.poll(() => terminalText(win)).toContain("fake-claude ready");
  await win.locator(".xterm").click();
  await win.keyboard.type("ask can I");
  await win.keyboard.press("Enter");
  await expect(win.getByTestId("session-status").first()).toContainText(/needs you/i, {
    timeout: 20000,
  });
  await win.getByTestId("rail-inbox").click();
  await expect(win.getByTestId("notification").first()).toContainText("Asker needs you");
  expect(session.id).toBeTruthy();

  // Uninstalling puts the file back as it was.
  await win.getByTestId("rail-setup").click();
  await win.getByTestId("uninstall-claude").click();
  await win.getByTestId("hooks-confirm").click();
  await expect(win.getByTestId("hooks-claude")).toContainText("not installed");
  expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).not.toContain(
    "office-relay",
  );
  await app.close();
});
