import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("the dropdown is Office's own: a button with a menu, keyboard navigable, and a Select that reports choices", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.getByTestId("rail-inbox").click();
  // No browser form control anywhere on the page.
  expect(await win.locator("select").count()).toBe(0);

  const filter = win.getByRole("combobox", { name: "Project" });
  await expect(filter).toContainText("All projects");
  await filter.click();
  const menu = win.getByTestId("select-menu");
  await expect(menu.getByRole("option")).toHaveText(["All projects", "Alpha", "Beta"]);
  await win.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Arrow keys and Enter choose, typing a letter jumps to an option.
  await filter.focus();
  await win.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await win.keyboard.press("ArrowDown");
  await win.keyboard.press("Enter");
  await expect(filter).toContainText("Alpha");
  await win.keyboard.press("Enter");
  await win.keyboard.type("b");
  await win.keyboard.press("Enter");
  await expect(filter).toContainText("Beta");
  // Clicking outside closes it without changing anything.
  await filter.click();
  await win.getByTestId("topbar-title").click();
  await expect(menu).toHaveCount(0);
  await expect(filter).toContainText("Beta");
  await app.close();
});

test("the chat header shows permission modes in words, and statuses are words in one colour everywhere", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  // Wide enough that the chat panel shows its model and permission controls instead of the overflow menu.
  await win.setViewportSize({ width: 1900, height: 950 });
  await expect(win.getByTestId("topbar")).toBeVisible();
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Wording",
      mode: "chat",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").first().click();

  await win.getByTestId("chat-permission-mode").click();
  await expect(win.getByTestId("select-menu").getByRole("option")).toHaveText([
    "Ask first (default)",
    "Accept edits",
    "Plan only",
    "Auto",
    "Allowed commands only",
  ]);
  await win.keyboard.press("Escape");
  await expect(win.getByTestId("chat-permission-mode")).toContainText("Ask first (default)");

  // Idle is a word; needs you is amber in the list, the chat header and Home alike.
  await expect(win.getByTestId("session-status").first()).toHaveText("Idle");
  await win.evaluate(
    (id) => window.office.invoke("chat.send", { id, text: "NEEDS_PERMISSION: rm -rf x" }),
    session.id,
  );
  await expect(win.getByTestId("session-status").first()).toHaveText("Needs you", {
    timeout: 30000,
  });
  const colour = (selector: string): Promise<string> =>
    win
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).color);
  const inList = await colour('[data-testid="session-status"] span');
  const inHeader = await colour('[data-testid="chat-header"] span:has-text("Needs you")');
  await win.getByTestId("rail-home").click();
  await expect(win.getByTestId("live-agent")).toContainText("Needs you");
  const onHome = await colour('[data-testid="live-agent"] span');
  expect(inHeader).toBe(inList);
  expect(onHome).toBe(inList);
  // A different status has a different colour (working is green, idle is muted).
  expect(inList).not.toBe("rgb(0, 0, 0)");
  await app.close();
});

test("a session's actions show on hover or focus and not before", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Hover me",
      mode: "chat",
    }),
  );
  await win.getByTestId("rail-agents").click();
  const row = win.getByTestId("session-row").first();
  const actions = row.locator(".session-actions");
  await win.mouse.move(700, 500);
  await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  // The actions float over the row: they do not reserve height of their own.
  expect(await actions.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
  // ...and never over the middle of the row, where a click opens the session.
  const rowBox = await row.boundingBox();
  const actionsBox = await actions.boundingBox();
  expect(actionsBox?.x ?? 0).toBeGreaterThan((rowBox?.x ?? 0) + (rowBox?.width ?? 0) / 2);
  const compact = (await row.boundingBox())?.height ?? 999;
  expect(compact).toBeLessThan(64);
  await row.hover();
  expect((await row.boundingBox())?.height).toBe(compact);
  await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await win.mouse.move(700, 500);
  await row.getByTestId("close-session").focus();
  await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await app.close();
});

test("the shortcuts sheet fits the window without scrolling, and its note is whole", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.keyboard.press("Control+/");
  const sheet = win.getByTestId("shortcuts-sheet");
  await expect(sheet).toBeVisible();
  const note = win.getByTestId("shortcuts-terminal-note");
  await expect(note).toBeInViewport({ ratio: 1 });
  const dialog = sheet.locator(".ui-dialog");
  const box = await dialog.boundingBox();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(860);
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await app.close();
});
