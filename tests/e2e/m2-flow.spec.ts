import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, terminalText } from "./helpers";

// The M2 milestone check: a working day on fixtures. Two agents run, one needs the owner, the owner
// answers it, one is closed with capture, the brain is asked a question and the brief is read.
test("a day in the workbench: two agents, a needs-you, capture, ask the brain and the brief", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();

  // Hooks are installed so the agents report like real Claude Code sessions.
  await win.evaluate(() =>
    window.office.invoke("hooks.apply", { target: "claude", action: "install" }),
  );

  // Two fake agents start.
  for (const [title, projectId] of [
    ["Alpha work", "alpha"],
    ["Beta work", "beta"],
  ] as const) {
    await win.evaluate(
      ([t, p]) =>
        window.office.invoke("sessions.start", { providerId: "fake", projectId: p, title: t }),
      [title, projectId] as const,
    );
  }
  await win.getByTestId("rail-agents").click();
  await expect(win.getByTestId("session-row")).toHaveCount(2);

  // One asks for permission: needs-you, an urgent inbox item.
  await win.getByTestId("session-row").filter({ hasText: "Alpha work" }).click();
  await expect.poll(() => terminalText(win)).toContain("fake-claude ready");
  await win.locator(".xterm").click();
  await win.keyboard.type("ask can I delete this");
  await win.keyboard.press("Enter");
  const alphaStatus = win
    .getByTestId("session-row")
    .filter({ hasText: "Alpha work" })
    .getByTestId("session-status");
  await expect(alphaStatus).toContainText(/needs you/i, { timeout: 20000 });
  await win.getByTestId("rail-inbox").click();
  await expect(win.getByTestId("notification").first()).toContainText("Alpha work needs you");

  // The owner answers it, and the session goes back to idle.
  await win.getByTestId("rail-agents").click();
  await win.locator(".xterm").click();
  await win.keyboard.type("yes");
  await win.keyboard.press("Enter");
  await expect(alphaStatus).toContainText("idle", { timeout: 20000 });

  // Closing it with capture sends both leftovers to the vault.
  await win
    .getByTestId("session-row")
    .filter({ hasText: "Alpha work" })
    .getByTestId("close-session")
    .click();
  await expect(win.getByTestId("capture-item")).toHaveCount(2);
  await win.getByTestId("capture-save").click();
  await expect(win.getByTestId("session-row")).toHaveCount(1, { timeout: 40000 });
  await expect
    .poll(() => readFileSync(join(world.hub, "Alpha", "OpenItems.md"), "utf8"), { timeout: 20000 })
    .toContain("Write the level two script");

  // Ask the brain, with a citation that opens the note.
  await win.getByTestId("rail-brain").click();
  await win.getByTestId("ask-input").fill("What is Alpha?");
  await win.getByTestId("ask-send").click();
  await expect(win.getByTestId("ask-answer")).toContainText("Alpha is a fixture game");
  await win.getByTestId("citation").first().click();
  await expect(win.getByTestId("note-viewer")).toBeVisible();

  // The morning brief lists the projects with news.
  await win.getByTestId("rail-home").click();
  await win.getByTestId("brief-run").click();
  await expect(win.getByTestId("brief-item").first()).toContainText("Fake brief for");
  await app.close();
});
