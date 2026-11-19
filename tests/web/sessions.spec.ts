import { expect, test } from "@playwright/test";
import { openDb } from "../../src/main/core/db";
import { join } from "node:path";
import { launch, pick } from "./helpers";

// M12.2 (Simplify 2.2): sessions with a goal and an end. The Agents view is now Sessions.

test("a session starts with its goal as its name, shows one session at a time, and ends with Wrap up", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-agents").click();
  await expect(win.getByRole("heading", { level: 1 })).toHaveText("Sessions");

  // Starting asks what the session is for, and will not start without it.
  await win.getByTestId("start-agent-open").click();
  await pick(win, "agent-project", { label: "Alpha" });
  await win.getByTestId("mode-provider").check();
  await pick(win, "agent-provider", { label: "Fake agent" });
  await expect(win.getByTestId("agent-start")).toBeDisabled();
  await win.getByTestId("agent-goal").fill("Tidy the sheep counter");
  await expect(win.getByTestId("agent-start")).toBeEnabled();
  await win.getByTestId("agent-start").click();

  // The goal is the name: in the list (under its project) and on the open session.
  await expect(win.getByTestId("session-group")).toContainText("Alpha");
  await expect(win.getByTestId("session-goal").first()).toHaveText("Tidy the sheep counter");
  await expect(win.getByTestId("tab")).toHaveCount(1);

  // A second session replaces the first on screen; the first keeps running and is one click away.
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Second goal",
      mode: "chat",
    }),
  );
  await win.getByTestId("session-row").filter({ hasText: "Second goal" }).click();
  await expect(win.getByTestId("tab")).toHaveCount(1);
  await expect(win.getByTestId("chat")).toBeVisible();
  await win.getByTestId("session-row").filter({ hasText: "Tidy the sheep counter" }).click();
  await expect(win.getByTestId("tab")).toHaveCount(1);
  await expect(win.getByTestId("terminal")).toBeVisible();
  // Splitting and floating are not on screen until the owner asks for several sessions.
  await expect(win.getByTestId("dock-split-right")).toHaveCount(0);

  // The terminal says how to get back, and wrapping up is offered in the session's own header.
  await expect(win.getByTestId("wrap-up")).toBeVisible();
  await win.getByTestId("wrap-up").click();
  await expect(win.getByTestId("capture-dialog")).toBeVisible();
  await win.getByTestId("capture-skip").click();
  await expect(
    win.getByTestId("session-row").filter({ hasText: "Tidy the sheep counter" }),
  ).toHaveCount(0, {
    timeout: 40000,
  });
  await app.close();
});

test("a chat offers the terminal with a line about what it is for, and a terminal always offers Back to chat", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Chat goal",
      mode: "chat",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").first().click();
  await expect(win.getByTestId("chat")).toBeVisible();
  await win.getByTestId("chat-more").click();
  await expect(win.getByTestId("chat-more-menu")).toContainText(
    "For slash commands, logins and anything the chat does not show",
  );
  await win.getByTestId("open-in-terminal").click();
  await expect(win.getByTestId("terminal")).toBeVisible();
  await expect(win.getByTestId("back-to-chat")).toBeVisible();
  await win.getByTestId("back-to-chat").click();
  await expect(win.getByTestId("chat")).toBeVisible();
  await app.close();
});

test("a session nobody touched for the idle time is asked about once, and Keep starts the time again", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const { base } = first;
  const win1 = await first.app.firstWindow();
  const session = await win1.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Forgotten goal",
      mode: "chat",
    }),
  );
  await first.app.close();
  // Three days pass: the session was last used then.
  const db = openDb(join(base, "data", "office.db"));
  const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
  db.prepare("UPDATE sessions SET updated_at = ?, last_output_at = NULL WHERE id = ?").run(
    old,
    session.id,
  );
  db.close();

  const second = await launch({ base, fakeTools: true });
  const win = await second.app.firstWindow();
  // Home counts it; Sessions asks.
  await expect(win.getByTestId("idle-sessions")).toContainText("1 session is past the idle time");
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Forgotten goal" }).click();
  await expect(win.getByTestId("idle-prompt")).toContainText("Still needed?");
  await win.getByTestId("idle-keep").click();
  await expect(win.getByTestId("idle-prompt")).toHaveCount(0);
  await win.getByTestId("rail-home").click();
  await expect(win.getByTestId("idle-sessions")).toHaveCount(0);
  await second.app.close();
});

test("a closed panel comes back from the Panels list and with Ctrl+Shift+T", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).click();
  await expect(win.getByTestId("tab-todos")).toBeVisible();

  // Close a panel; it can be brought back from the Layout menu, which lists every panel with a check for the open ones.
  await win.getByTestId("tab-todos").getByRole("button", { name: "Close tab" }).click();
  await expect(win.getByTestId("tab-todos")).toHaveCount(0);
  await win.getByTestId("workbench-layout").click();
  const todos = win.getByTestId("workbench-panel-todos");
  await expect(todos).not.toContainText("✓");
  await expect(win.getByTestId("workbench-panel-overview")).toContainText("✓");
  await todos.click();
  await expect(win.getByTestId("tab-todos")).toBeVisible();

  // Closing another and pressing Ctrl+Shift+T brings back the one closed last.
  await win.getByTestId("tab-notes").getByRole("button", { name: "Close tab" }).click();
  await expect(win.getByTestId("tab-notes")).toHaveCount(0);
  await win.keyboard.press("Control+Shift+T");
  await expect(win.getByTestId("tab-notes")).toBeVisible();
  await app.close();
});
