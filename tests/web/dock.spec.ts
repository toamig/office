import { expect, test, type Page } from "@playwright/test";
import { allowSeveralSessions, launch } from "./helpers";

/** Opens the Layout menu in the page header and picks one of its items by name. */
async function layout(win: Page, item: string): Promise<void> {
  await win.getByTestId("workbench-layout").click();
  await win.getByTestId("workbench-layout-menu").getByRole("menuitem", { name: item }).click();
}

/** Two sessions of the fake provider in Alpha: a chat and a terminal. */
async function twoSessions(win: Page): Promise<void> {
  await allowSeveralSessions(win);
  await win.evaluate(async () => {
    await window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Terminal work",
      mode: "terminal",
    });
    await window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Chat work",
      mode: "chat",
    });
  });
}

const left = async (win: Page, testId: string): Promise<number> =>
  (await win.getByTestId(testId).boundingBox())?.x ?? Number.NaN;

test("a chat is docked beside a terminal, a diff is floated, and the layout is found again after a restart", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const win = await first.app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  await twoSessions(win);
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Terminal work" }).click();
  await expect(win.getByTestId("terminal")).toBeVisible();
  await win.getByTestId("session-row").filter({ hasText: "Chat work" }).click();
  await expect(win.getByTestId("chat")).toBeVisible();
  // Both are tabs of one group, and only the chat is showing.
  await expect(win.getByTestId("tab")).toHaveCount(2);
  await expect(win.getByTestId("terminal")).toBeHidden();

  // The review layout adds the changes and a preview; the changes are floated.
  await layout(win, "Arrange: Review: conversation, changes and preview");
  await expect(win.getByTestId("dock-tab").filter({ hasText: "Changes" })).toBeVisible();
  await win.getByTestId("dock-tab").filter({ hasText: "Changes" }).click();
  await win.getByTestId("dock-float").last().click();
  await expect(win.locator('[data-testid="workbench"] .dv-resize-container')).toHaveCount(1);

  // Dock the chat to the right of the terminal.
  await win.getByTestId("tab").filter({ hasText: "Chat work" }).click();
  await win.getByTestId("dock-split-right").first().click();
  await win.getByTestId("tab").filter({ hasText: "Terminal work" }).click();
  await expect(win.getByTestId("terminal")).toBeVisible();
  await expect(win.getByTestId("chat")).toBeVisible();
  await expect
    .poll(async () => (await left(win, "chat")) - (await left(win, "terminal")))
    .toBeGreaterThan(150);
  // The layout is saved on this PC.
  await expect
    .poll(async () => {
      const json = await win.evaluate(() =>
        window.office.invoke("dock.get", { key: "agents:all" }),
      );
      return json ? (JSON.parse(json) as { floatingGroups?: unknown[] }).floatingGroups?.length : 0;
    })
    .toBe(1);
  await first.app.close();

  // After a restart the same arrangement is there: the chat right of the terminal, and the changes floating.
  const second = await launch({ world: true, fakeTools: true, base: first.base });
  const again = await second.app.firstWindow();
  await again.setViewportSize({ width: 1700, height: 950 });
  await again.getByTestId("rail-agents").click();
  await expect(again.getByTestId("tab").filter({ hasText: "Terminal work" })).toBeVisible();
  await expect(again.getByTestId("tab").filter({ hasText: "Chat work" })).toBeVisible();
  await expect(again.locator('[data-testid="workbench"] .dv-resize-container')).toHaveCount(1);
  await expect(again.getByTestId("terminal")).toBeVisible();
  await expect(again.getByTestId("chat")).toBeVisible();
  await expect
    .poll(async () => (await left(again, "chat")) - (await left(again, "terminal")))
    .toBeGreaterThan(150);
  await second.app.close();
});

test("a terminal moved between groups keeps its scrollback, and a chat keeps streaming while panels move", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  await twoSessions(win);
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Terminal work" }).click();
  await expect(win.getByTestId("terminal")).toBeVisible();
  const buffer = (): Promise<string> =>
    win.evaluate(() => {
      const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
        __term?: {
          buffer: {
            active: {
              length: number;
              getLine: (i: number) => { translateToString: (t: boolean) => string } | undefined;
            };
          };
        };
      };
      const b = host?.__term?.buffer.active;
      if (!b) return "";
      let out = "";
      for (let i = 0; i < b.length; i++) out += `${b.getLine(i)?.translateToString(true) ?? ""}\n`;
      return out;
    });
  await expect.poll(buffer, { timeout: 30000 }).toContain("fake-claude ready");
  await win.getByTestId("session-row").filter({ hasText: "Chat work" }).click();
  await expect(win.getByTestId("chat")).toBeVisible();

  // Mark the live objects: a remount would lose the marks.
  await win.evaluate(() => {
    type Marked = HTMLElement & { __mark?: string };
    (document.querySelector('[data-testid="chat"]') as Marked).__mark = "same-chat";
    (document.querySelector('[data-testid="terminal"]') as Marked).__mark = "same-terminal";
  });

  // A turn starts, and the panels are moved while it streams: split, tab together again, and side by side.
  await win.getByTestId("composer-input").fill("THINK READ src/sheep.ts EDIT TODO");
  await win.getByTestId("composer-input").press("Enter");
  await win.getByTestId("dock-split-right").first().click();
  await layout(win, "Arrange: Focus: one panel at a time");
  await layout(win, "Arrange: Side by side");
  await expect(win.getByTestId("terminal")).toBeVisible();
  await expect(win.getByTestId("chat")).toBeVisible();

  const marks = await win.evaluate(() => ({
    chat: (document.querySelector('[data-testid="chat"]') as HTMLElement & { __mark?: string })
      .__mark,
    terminal: (
      document.querySelector('[data-testid="terminal"]') as HTMLElement & { __mark?: string }
    ).__mark,
  }));
  expect(marks).toEqual({ chat: "same-chat", terminal: "same-terminal" });
  // The terminal still has what it printed, and the chat's turn finished: it kept streaming through the moves.
  expect(await buffer()).toContain("fake-claude ready");
  await expect(win.getByTestId("chat")).toContainText("Done in", { timeout: 30000 });
  await app.close();
});

test("a layout can be saved under a name, left, and switched back to; Reset goes back to the default", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).click();
  // The project page is a dock of panels: Overview and Todos are tabs of one group at first.
  await expect(win.getByTestId("tab-overview")).toBeVisible();
  await expect(win.getByTestId("tab-todos")).toBeVisible();
  await expect(win.getByTestId("tab-git")).toBeVisible();
  const overview = win.getByTestId("panel-git-state");
  await expect(overview).toBeVisible();

  await layout(win, "Arrange: Overview beside Todos");
  await expect(win.getByTestId("panel-project-waiting")).toBeVisible();
  await expect(overview).toBeVisible();
  await layout(win, "Save layout as...");
  await win.getByTestId("layout-name").fill("Overview and todos");
  await win.getByTestId("layout-name-save").click();

  await layout(win, "Reset layout");
  await expect(win.getByTestId("panel-project-waiting")).toBeHidden();
  await expect(overview).toBeVisible();

  await layout(win, "Open layout: Overview and todos");
  await expect(win.getByTestId("panel-project-waiting")).toBeVisible();
  await expect(overview).toBeVisible();
  await app.close();
});
