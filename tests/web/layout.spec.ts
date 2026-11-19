import { expect, test, type Page } from "@playwright/test";
import { launch } from "./helpers";

const VIEWS = [
  "home",
  "projects",
  "agents",
  "git",
  "board",
  "brain",
  "inbox",
  "explore",
  "setup",
] as const;
const WIDTHS = [1024, 1366, 1920, 2560] as const;

/**
 * How much of the content area's width has nothing drawn in it: the share of its width not covered by any text,
 * control, picture, surface (a background, a shadow or a full border). Cards and panels count as drawn; a wide empty
 * band to the right of a narrow column is what this finds.
 */
async function emptyShare(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("main.app-main, .app-main") as HTMLElement;
    const box = main.getBoundingClientRect();
    const spans: Array<[number, number]> = [];
    const visible = (el: Element): boolean => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
    };
    const add = (r: DOMRect): void => {
      const a = Math.max(r.left, box.left);
      const b = Math.min(r.right, box.right);
      if (b > a) spans.push([a, b]);
    };
    for (const el of main.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const text = [...el.childNodes].some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
      );
      const control = [
        "button",
        "input",
        "select",
        "textarea",
        "svg",
        "img",
        "canvas",
        "iframe",
        "table",
      ].includes(tag);
      const surface =
        (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") ||
        s.boxShadow !== "none" ||
        (parseFloat(s.borderTopWidth) > 0 &&
          parseFloat(s.borderBottomWidth) > 0 &&
          parseFloat(s.borderLeftWidth) > 0 &&
          parseFloat(s.borderRightWidth) > 0);
      if (text) {
        // The box of the text itself, not of the wide container that holds it.
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const q of range.getClientRects()) add(q);
      } else if (control || surface) add(r);
    }
    spans.sort((x, y) => x[0] - y[0]);
    let covered = 0;
    let end = box.left;
    for (const [a, b] of spans) {
      const from = Math.max(a, end);
      if (b > from) {
        covered += b - from;
        end = b;
      }
    }
    return 1 - covered / box.width;
  });
}

test("no view has more than a third of its width empty, at 1024, 1366, 1920 and 2560 wide", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1366, height: 860 });
  await expect(win.getByTestId("topbar")).toBeVisible();
  // Something running, so Agents has a session to show.
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Level work",
    }),
  );
  const empty: string[] = [];
  for (const width of WIDTHS) {
    await win.setViewportSize({ width, height: width >= 1920 ? 1080 : 800 });
    for (const view of [...VIEWS, "project"] as const) {
      if (view === "project") {
        await win.getByTestId("rail-projects").click();
        await win.getByTestId("project-card").first().click();
      } else {
        await win.getByTestId(`rail-${view}`).click();
      }
      if (view === "agents") await win.getByTestId("session-row").first().click();
      await win.waitForTimeout(450);
      const share = await emptyShare(win);
      if (share > 1 / 3)
        empty.push(`${view} at ${width}: ${(share * 100).toFixed(0)} percent empty`);
    }
  }
  expect(empty).toEqual([]);
  await app.close();
});

test("a divider that is dragged stays where it was put after a restart", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const win = await first.app.firstWindow();
  await win.setViewportSize({ width: 1600, height: 900 });
  await win.getByTestId("rail-agents").click();
  const pane = win.getByTestId("split-agents").locator(".ui-split-pane").first();
  const before = (await pane.boundingBox())?.width ?? 0;
  const handle = await win.getByTestId("split-agents-divider").boundingBox();
  if (!handle) throw new Error("no divider");
  const y = handle.y + handle.height / 2;
  await win.mouse.move(handle.x + 3, y);
  await win.mouse.down();
  await win.mouse.move(handle.x + 3 + 150, y, { steps: 6 });
  await win.mouse.up();
  await expect
    .poll(async () => (await pane.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before + 120);
  const after = Math.round((await pane.boundingBox())?.width ?? 0);
  // It is saved on this PC, not just held in the page.
  await expect
    .poll(() =>
      win.evaluate(() => window.office.invoke("settings.get").then((s) => s.panes["agents"])),
    )
    .toBe(after);
  await first.app.close();

  const second = await launch({ base: first.base, fakeTools: true });
  const again = await second.app.firstWindow();
  await again.setViewportSize({ width: 1600, height: 900 });
  await again.getByTestId("rail-agents").click();
  const pane2 = again.getByTestId("split-agents").locator(".ui-split-pane").first();
  await expect.poll(async () => Math.round((await pane2.boundingBox())?.width ?? 0)).toBe(after);
  // The keyboard moves it too, by steps, and never past the least width of either pane.
  await again.getByTestId("split-agents-divider").focus();
  await again.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => Math.round((await pane2.boundingBox())?.width ?? 0))
    .toBe(after - 16);
  await second.app.close();
});

test("the sidebar is 240 wide, resizes between 200 and 320, collapses to 56, and remembers its width", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const win = await first.app.firstWindow();
  const bar = win.getByTestId("rail");
  expect(Math.round((await bar.boundingBox())?.width ?? 0)).toBe(240);
  const grip = await win.getByTestId("sidebar-resizer").boundingBox();
  if (!grip) throw new Error("no resizer");
  const y = grip.y + grip.height / 2;
  // Dragged far past the limits it stops at 320 and at 200.
  await win.mouse.move(grip.x + 3, y);
  await win.mouse.down();
  await win.mouse.move(grip.x + 400, y, { steps: 5 });
  await win.mouse.up();
  await expect.poll(async () => Math.round((await bar.boundingBox())?.width ?? 0)).toBe(320);
  await expect
    .poll(() =>
      win.evaluate(() => window.office.invoke("settings.get").then((s) => s.sidebarWidth)),
    )
    .toBe(320);
  const grip2 = await win.getByTestId("sidebar-resizer").boundingBox();
  if (!grip2) throw new Error("no resizer");
  await win.mouse.move(grip2.x + 3, y);
  await win.mouse.down();
  await win.mouse.move(grip2.x - 150, y, { steps: 5 });
  await win.mouse.up();
  await expect.poll(async () => Math.round((await bar.boundingBox())?.width ?? 0)).toBe(200);
  await expect
    .poll(() =>
      win.evaluate(() => window.office.invoke("settings.get").then((s) => s.sidebarWidth)),
    )
    .toBe(200);
  await win.getByTestId("sidebar-toggle").click();
  await expect.poll(async () => Math.round((await bar.boundingBox())?.width ?? 0)).toBe(56);
  await win.getByTestId("sidebar-toggle").click();
  await expect.poll(async () => Math.round((await bar.boundingBox())?.width ?? 0)).toBe(200);
  await first.app.close();

  const second = await launch({ base: first.base, fakeTools: true });
  const again = await second.app.firstWindow();
  await expect
    .poll(async () => Math.round((await again.getByTestId("rail").boundingBox())?.width ?? 0))
    .toBe(200);
  await second.app.close();
});

test("Home is one column below 1100 wide, two up to 1600, and three above", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  const columns = (): Promise<number> =>
    win
      .getByTestId("home")
      .locator(".home-grid")
      .evaluate((el) => Number(getComputedStyle(el).columnCount));
  // The widths are the content's: the window less the sidebar.
  for (const [window, count] of [
    [1100, 1],
    [1366, 2],
    [1920, 3],
    [2560, 3],
  ] as const) {
    await win.setViewportSize({ width: window, height: 900 });
    await expect.poll(columns).toBe(count);
  }
  await app.close();
});
