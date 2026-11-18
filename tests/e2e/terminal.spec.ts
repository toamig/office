import { expect, test } from "@playwright/test";
import { launch, terminalText } from "./helpers";

test("a terminal takes the panel's background and follows a theme change, with a header strip and find", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.evaluate(() => window.office.invoke("settings.set", { theme: "dark" }));
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Themed terminal",
    }),
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").first().click();
  await expect.poll(() => terminalText(win)).toContain("fake-claude ready");

  const colours = (): Promise<{ term: string; panel: string; frame: string }> =>
    win.evaluate(() => {
      const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
        __term?: { options: { theme?: { background?: string } } };
      };
      const frame = document.querySelector('[data-testid="terminal-frame"]') as HTMLElement;
      const probe = document.createElement("div");
      probe.style.background = "var(--panel)";
      document.body.appendChild(probe);
      const panel = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const swatch = document.createElement("div");
      swatch.style.background = host.__term?.options.theme?.background ?? "";
      document.body.appendChild(swatch);
      const term = getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      return { term, panel, frame: getComputedStyle(frame).backgroundColor };
    });

  const dark = await colours();
  expect(dark.term).toBe(dark.panel);
  expect(dark.frame).toBe(dark.panel);

  // Switching the theme with the terminal open restyles it at once.
  await win.evaluate(() => window.office.invoke("settings.set", { theme: "light" }));
  await expect
    .poll(async () => {
      const c = await colours();
      return c.term === c.panel && c.panel !== dark.panel;
    })
    .toBe(true);

  // The header strip shows the session's name, status and a Stop button.
  const header = win.getByTestId("pane-header");
  await expect(header).toContainText("Themed terminal");
  await expect(header.getByTestId("pane-stop")).toBeVisible();

  // Ctrl+F opens find in the terminal under the pointer or focus, and Escape closes it.
  await win.locator(".xterm").click();
  await win.keyboard.press("Control+f");
  await expect(win.getByTestId("terminal-find-input")).toBeFocused();
  await win.getByTestId("terminal-find-input").fill("ready");
  await win.keyboard.press("Enter");
  await win.keyboard.press("Escape");
  await expect(win.getByTestId("terminal-find")).toHaveCount(0);
  await app.close();
});
