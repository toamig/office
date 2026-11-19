import { expect, test, type Page } from "@playwright/test";
import { launch, terminalText, pick } from "./helpers";

async function openChat(win: Page, input: Record<string, unknown>): Promise<string> {
  await expect(win.getByTestId("topbar")).toBeVisible();
  const session = await win.evaluate((i) => window.office.invoke("sessions.start", i as never), {
    projectId: "alpha",
    mode: "chat",
    ...input,
  });
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").first().click();
  await expect(win.getByTestId("chat")).toBeVisible();
  return session.id;
}

async function say(win: Page, text: string): Promise<void> {
  const box = win.getByTestId("composer-input");
  await box.fill(text);
  await box.press("Enter");
}

test("a Claude chat streams an answer, draws tool cards, an edit diff, a checklist and thinking", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await openChat(win, { providerId: "fake", title: "Chat one" });
  await expect(win.getByTestId("chat-empty")).toBeVisible();

  await say(win, "THINK READ src/a.ts EDIT TODO RUN git status");
  await expect(win.getByTestId("chat-user")).toContainText("READ src/a.ts");
  // The answer, then the end of the turn with its duration.
  await expect(win.getByTestId("chat-turn")).toContainText(/Done in/, { timeout: 30000 });
  await expect(win.getByTestId("chat-assistant").last()).toContainText("echo: THINK READ");

  const cards = win.getByTestId("tool-card");
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toHaveAttribute("data-tool", "Read");
  await expect(cards.nth(0)).toContainText("src/a.ts");
  // An edit shows what it replaced.
  await expect(cards.nth(1)).toHaveAttribute("data-tool", "Edit");
  await expect(cards.nth(1).getByTestId("edit-diff")).toContainText("- one");
  await expect(cards.nth(1).getByTestId("edit-diff")).toContainText("+ two");
  // A to-do list is a checklist.
  await expect(win.getByTestId("todo-list")).toContainText("Write the test");
  // A command's output is folded until it is opened.
  const bash = cards
    .filter({ has: win.locator('[data-tool="Bash"]') })
    .or(win.locator('[data-tool="Bash"]'));
  await expect(bash.first().getByTestId("tool-output")).toHaveCount(0);
  await bash.first().getByRole("button").first().click();
  await expect(bash.first().getByTestId("tool-output")).toContainText("ran: git status");
  // Thinking sits under a toggle.
  await expect(win.getByTestId("thinking")).toBeVisible();
  await expect(win.getByTestId("thinking")).not.toContainText("Let me think");
  await win.getByTestId("thinking").getByRole("button").click();
  await expect(win.getByTestId("thinking")).toContainText("Let me think about it.");

  // A second message goes on in the same chat.
  await say(win, "and again");
  await expect(win.getByTestId("chat-turn")).toHaveCount(2, { timeout: 30000 });
  await app.close();
});

test("an approval is a card in the conversation: Deny returns the reason, Allow lets the turn finish", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await openChat(win, { providerId: "fake", title: "Asks first" });

  await say(win, "NEEDS_PERMISSION: rm -rf build");
  const card = win.getByTestId("chat").getByTestId("permission-request");
  await expect(card).toContainText("rm -rf build", { timeout: 30000 });
  await expect(win.getByTestId("session-status").first()).toContainText(/needs you/i);
  // The same question waits in the Inbox too.
  await card.getByTestId("permission-reason").fill("not in this project");
  await card.getByTestId("permission-deny").click();
  await expect(win.getByTestId("chat-turn")).toBeVisible({ timeout: 30000 });
  await expect(win.getByTestId("chat")).toContainText("The owner declined: not in this project");

  await say(win, "NEEDS_PERMISSION: make release");
  await expect(card).toContainText("make release", { timeout: 30000 });
  await card.getByTestId("permission-allow").click();
  await expect(win.getByTestId("chat-turn")).toHaveCount(2, { timeout: 30000 });
  await expect(win.getByTestId("chat")).toContainText("after the owner allowed it");
  await app.close();
});

test("Stop ends a running turn, and the next message resumes the same conversation", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await openChat(win, { providerId: "fake", title: "Stoppable" });

  await say(win, "SLOW please");
  await expect(win.getByTestId("chat-stop")).toBeVisible({ timeout: 20000 });
  await win.getByTestId("chat-stop").click();
  await expect(win.getByTestId("chat-stopped")).toBeVisible();
  await expect(win.getByTestId("chat-send")).toBeVisible();

  await say(win, "carry on");
  await expect(win.getByTestId("chat-turn")).toBeVisible({ timeout: 30000 });
  await expect(win.getByTestId("chat")).toContainText("echo: carry on");
  // The earlier messages are still on screen.
  await expect(win.getByTestId("chat-user")).toHaveCount(2);
  await app.close();
});

test("@ mentions a project file, and Shift+Enter adds a line instead of sending", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await openChat(win, { providerId: "fake" });
  const box = win.getByTestId("composer-input");
  await box.fill("look at @READ");
  await expect(win.getByTestId("mention-list")).toContainText("README.md");
  await box.press("Enter");
  await expect(box).toHaveValue("look at @README.md ");
  await box.press("Shift+Enter");
  // The line break is inserted after the key event; wait for it, or the next characters can overtake it.
  await expect(box).toHaveValue("look at @README.md \n");
  await box.type("then this");
  await expect(box).toHaveValue("look at @README.md \nthen this");
  await expect(win.getByTestId("chat-user")).toHaveCount(0);
  await box.press("Enter");
  await expect(win.getByTestId("chat-user")).toContainText("@README.md");
  await app.close();
});

test("a Codex chat runs two turns on one thread and shows its sandbox", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await openChat(win, { providerId: "codex", title: "Codex chat" });
  await expect(win.getByTestId("chat-sandbox")).toContainText("can write to the workspace");
  await say(win, "first question");
  await expect(win.getByTestId("chat-turn")).toHaveCount(1, { timeout: 30000 });
  await expect(win.getByTestId("chat")).toContainText("FAKE CODEX: first question");
  await say(win, "second question");
  await expect(win.getByTestId("chat-turn")).toHaveCount(2, { timeout: 30000 });
  await expect(win.getByTestId("chat")).toContainText("FAKE CODEX: second question");
  const rows = await win.evaluate(() => window.office.invoke("sessions.list", {}));
  expect(rows[0]?.providerSessionId).toBeTruthy();
  await app.close();
});

test("a chat opens in a terminal and comes back on the same provider session, and a past chat reopens", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  // Wide enough that the chat panel shows Open in terminal itself instead of in its overflow menu.
  await win.setViewportSize({ width: 1900, height: 950 });
  const id = await openChat(win, { providerId: "fake", title: "Switcher" });
  await say(win, "before the switch");
  await expect(win.getByTestId("chat-turn")).toBeVisible({ timeout: 30000 });

  await win.getByTestId("open-in-terminal").click();
  await expect(win.getByTestId("terminal")).toBeVisible();
  await expect.poll(() => terminalText(win), { timeout: 20000 }).toContain("fake-claude ready");
  await expect.poll(() => terminalText(win)).toContain(id);
  await expect(win.getByTestId("back-to-chat")).toBeVisible();

  await win.getByTestId("back-to-chat").click();
  await expect(win.getByTestId("chat")).toBeVisible();
  await expect(win.getByTestId("chat")).toContainText("before the switch");
  await say(win, "after the switch");
  await expect(win.getByTestId("chat-turn")).toHaveCount(2, { timeout: 30000 });
  const row = (await win.evaluate(() => window.office.invoke("sessions.list", {})))[0];
  expect(row).toMatchObject({ mode: "chat", providerSessionId: id });

  // Leaving the view and coming back replays the stored conversation.
  await win.getByTestId("rail-home").click();
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").first().click();
  await expect(win.getByTestId("chat-user")).toHaveCount(2);
  await app.close();
});

test("the Start agent dialog offers Chat or Terminal and remembers the choice", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.getByTestId("rail-agents").click();
  await win.getByRole("button", { name: /Start agent/ }).click();
  await pick(win, "agent-project", { label: "Alpha" });
  await win.getByTestId("mode-provider").check();
  await pick(win, "agent-provider", { label: "Fake agent" });
  await expect(win.getByTestId("mode-terminal")).toBeChecked(); // the machine's earlier choice
  await win.getByTestId("mode-chat").check();
  await win.getByTestId("agent-start").click();
  await expect(win.getByTestId("chat")).toBeVisible({ timeout: 20000 });
  expect((await win.evaluate(() => window.office.invoke("settings.get"))).sessionMode).toBe("chat");
  await app.close();
});

test("a session that began as a terminal goes to a chat and resumes its conversation", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Began in a terminal",
      mode: "terminal",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").first().click();
  await expect.poll(() => terminalText(win), { timeout: 20000 }).toContain("fake-claude ready");
  await win.locator(".xterm").click();
  await win.keyboard.type("typed in the terminal");
  await win.keyboard.press("Enter");
  await expect.poll(() => terminalText(win)).toContain("echo: typed in the terminal");

  await win.getByTestId("back-to-chat").click();
  await expect(win.getByTestId("chat")).toBeVisible();
  await say(win, "now from the chat");
  await expect(win.getByTestId("chat-turn")).toBeVisible({ timeout: 30000 });
  await expect(win.getByTestId("chat")).toContainText("echo: now from the chat");
  await expect(win.getByTestId("chat-error")).toHaveCount(0);
  const row = (await win.evaluate(() => window.office.invoke("sessions.list", {})))[0];
  expect(row).toMatchObject({ id: session.id, mode: "chat", conversationStarted: true });
  await app.close();
});
