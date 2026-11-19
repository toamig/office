import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, repoRoot } from "./helpers";

const out = join(repoRoot, "test-results", "look");

test("the Gallery shows every component, and a status looks the same wherever it is", async () => {
  const { app, page } = await launch({ world: true });
  await page.getByTestId("rail-gallery").click();
  await expect(page.getByTestId("gallery")).toBeVisible();
  for (const section of [
    "type",
    "colour",
    "buttons",
    "fields",
    "status-badges",
    "feedback",
    "surfaces",
    "dialogs-and-notifications",
  ])
    await expect(page.getByTestId(`gallery-${section}`)).toBeVisible();

  // Every status in the table has a badge with its word and its tone.
  const badges = page.getByTestId("gallery-statuses").locator(".ui-badge");
  expect(await badges.count()).toBeGreaterThan(30);
  const tones = await badges.evaluateAll((els) =>
    Object.fromEntries(
      els.map((e) => [e.getAttribute("data-status"), e.getAttribute("data-tone")]),
    ),
  );
  expect(tones["up-to-date"]).toBe("success");
  expect(tones["needs-you"]).toBe("attention");
  expect(tones["failed"]).toBe("danger");
  expect(tones["idle"]).toBe("neutral");
  // Grey is never a good outcome: the colour of "up to date" is not the colour of "idle".
  const colour = (status: string): Promise<string> =>
    page
      .getByTestId("gallery-statuses")
      .locator(`[data-status="${status}"]`)
      .evaluate((e) => getComputedStyle(e).color);
  expect(await colour("up-to-date")).not.toBe(await colour("idle"));
  await app.close();
});

test("a dialog takes focus, keeps Tab inside, closes on Esc and gives focus back", async () => {
  const { app, page } = await launch({ world: true });
  await page.getByTestId("rail-gallery").click();
  const opener = page.getByTestId("gallery-open-dialog");
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", { name: "A dialog" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await app.close();
});

test("notifications stack in the corner, never take focus, and leave on their own", async () => {
  const { app, page } = await launch({ world: true });
  await page.clock.install();
  await page.getByTestId("rail-gallery").click();
  const before = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  await page.getByTestId("gallery-notify-success").click();
  await page.getByTestId("gallery-notify-attention").click();
  await page.getByTestId("gallery-notify-danger").click();
  const toasts = page.getByTestId("notification-toast");
  await expect(toasts).toHaveCount(3);
  // The stack is in the bottom-right corner and holds no focus of its own.
  const box = await page.getByTestId("notification-stack").boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(1300);
  expect(
    await page.evaluate(() =>
      document.activeElement?.closest('[data-testid="notification-stack"]'),
    ),
  ).toBeNull();
  expect(before).not.toBe("notification-stack");
  // Success leaves after 4 s, a warning after 8 s, and an error stays until closed.
  await page.clock.fastForward(4500);
  await expect(toasts).toHaveCount(2);
  await page.clock.fastForward(4000);
  await expect(toasts).toHaveCount(1);
  await page.clock.fastForward(60000);
  await expect(toasts).toHaveCount(1);
  await toasts.getByRole("button", { name: "Close notification" }).click();
  await expect(toasts).toHaveCount(0);
  await app.close();
});

test("the Gallery in both themes at 1366 and 1920 wide", async () => {
  mkdirSync(out, { recursive: true });
  const { app, page } = await launch({ world: true });
  await page.getByTestId("rail-gallery").click();
  await expect(page.getByTestId("gallery")).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => window.office.invoke("settings.set", { theme: t }), theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const [width, height] of [
      [1366, 860],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(out, `gallery-${theme}-${width}.png`), fullPage: false });
      await page.getByTestId("gallery").evaluate((el) => {
        const scroller = el.closest(".app-main");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `gallery-${theme}-${width}-bottom.png`) });
      await page.getByTestId("gallery").evaluate((el) => {
        const scroller = el.closest(".app-main");
        if (scroller) scroller.scrollTop = 0;
      });
    }
  }
  await app.close();
});
