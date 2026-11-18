import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("the window buttons follow the theme, and the window reopens where it was left", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const win = await first.app.firstWindow();
  const chrome = (): Promise<{ theme: string; overlayColor: string; background: string }> =>
    win.evaluate(() => window.office.invoke("app.chrome"));

  // Dark and light give different colours to the native buttons and the window background.
  await win.evaluate(() => window.office.invoke("settings.set", { theme: "dark" }));
  await expect.poll(async () => (await chrome()).theme).toBe("dark");
  const dark = await chrome();
  await win.evaluate(() => window.office.invoke("settings.set", { theme: "light" }));
  await expect.poll(async () => (await chrome()).theme).toBe("light");
  const light = await chrome();
  expect(light.overlayColor).not.toBe(dark.overlayColor);
  expect(light.background).not.toBe(dark.background);
  // The page itself shows the same palette.
  await expect
    .poll(() => win.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("light");
  const panel = await win.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue("--panel").trim(),
  );
  expect(panel.toLowerCase()).toBe(light.overlayColor.toLowerCase());

  // The top bar is the drag region and its controls are not.
  const drag = await win.evaluate(() => {
    const top = document.querySelector('[data-testid="topbar"]') as HTMLElement;
    const button = document.querySelector('[data-testid="sync-all"]') as HTMLElement;
    return [
      getComputedStyle(top).getPropertyValue("-webkit-app-region"),
      getComputedStyle(button).getPropertyValue("-webkit-app-region"),
    ];
  });
  expect(drag).toEqual(["drag", "no-drag"]);

  // Bounds are saved when the window moves and come back after a restart.
  await first.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 120, y: 90, width: 1040, height: 720 });
  });
  await new Promise((r) => setTimeout(r, 900));
  await first.app.close();

  const second = await launch({ world: true, fakeTools: true, base: first.base });
  await second.app.firstWindow();
  const bounds = await second.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getBounds(),
  );
  expect(bounds).toMatchObject({ x: 120, y: 90, width: 1040, height: 720 });
  await second.app.close();
});
