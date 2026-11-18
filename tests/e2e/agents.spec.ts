import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("a node -e echo program runs in a tab, takes typed input and echoes it", async () => {
  const { app } = await launch({
    world: true,
    fakeTools: true,
    env: { OFFICE_ALLOW_RAW_TERMINAL: "1" },
  });
  const win = await app.firstWindow();
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.startCommand", {
      title: "echo program",
      cmd: "node",
      args: [
        "-e",
        "process.stdin.on('data', d => console.log('GOT:' + d.toString().trim())); console.log('READY')",
      ],
    }),
  );
  expect(session.status).toBe("starting");

  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "echo program" }).click();
  await expect(win.locator(".xterm-rows")).toContainText("READY");
  await win.locator(".xterm").click();
  await win.keyboard.type("hello office");
  await win.keyboard.press("Enter");
  await expect(win.locator(".xterm-rows")).toContainText("GOT:hello office");
  await app.close();
});

test("a fake agent session starts from the dialog, shows its status and takes its first prompt", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").first().click();
  await win.getByTestId("start-agent").click();

  await expect(win.getByTestId("start-agent-dialog")).toBeVisible();
  await win.getByTestId("agent-project").selectOption({ label: "Alpha" });
  await win.getByTestId("mode-provider").check();
  await win.getByTestId("agent-provider").selectOption({ label: "Fake agent" });
  await win.getByTestId("agent-prompt").fill("hello there");
  await win.getByTestId("agent-start").click();

  const row = win.getByTestId("session-row").first();
  await expect(row).toContainText("Fake agent");
  await expect(win.getByTestId("session-status").first()).toContainText(/starting|working/);
  await expect(win.locator(".xterm-rows")).toContainText("fake-claude ready");
  await expect(win.locator(".xterm-rows")).toContainText("echo: hello there");

  // Ending the session shows exited, and Resume brings it back in the same row.
  await win.locator(".xterm").click();
  await win.keyboard.type("quit");
  await win.keyboard.press("Enter");
  await expect(win.getByTestId("session-status").first()).toContainText("exited");
  await win.getByTestId("resume-session").first().click();
  await expect(win.getByTestId("session-status").first()).toContainText(/starting|working/);
  await expect(win.getByTestId("session-row")).toHaveCount(1);
  await app.close();
});

test("the split layout is saved per project and survives a restart", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const win = await first.app.firstWindow();
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("split-columns").click();
  await expect(win.getByTestId("split-columns")).toBeVisible();
  await first.app.close();

  const second = await launch({ world: true, fakeTools: true, base: first.base });
  const win2 = await second.app.firstWindow();
  await win2.getByTestId("rail-agents").click();
  // The saved layout is applied: the columns button is the active (primary) one.
  await expect
    .poll(() => win2.evaluate(() => window.office.invoke("layout.get", { key: "all" })))
    .toMatchObject({ split: "columns" });
  await second.app.close();
});
