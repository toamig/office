import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("Ctrl+/ opens the shortcuts sheet, the view keys work, and history walks back and forward", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.keyboard.press("Control+/");
  const sheet = win.getByTestId("shortcuts-sheet");
  await expect(sheet).toContainText("Jump to anything");
  await expect(sheet).toContainText("Ctrl+Shift+A");
  await win.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await win.keyboard.press("Control+2");
  await expect(win.getByTestId("projects")).toBeVisible();
  await win.keyboard.press("Control+,");
  await expect(win.getByRole("heading", { level: 1 })).toHaveText("Setup");
  await win.keyboard.press("Alt+ArrowLeft");
  await expect(win.getByTestId("projects")).toBeVisible();
  await win.getByTestId("history-forward").click();
  await expect(win.getByRole("heading", { level: 1 })).toHaveText("Setup");
  await win.getByTestId("rail-home").click();
  await win.getByTestId("sidebar-toggle").click();
  await expect(win.getByTestId("rail")).toHaveAttribute("data-collapsed", "true");
  await win.keyboard.press("Control+B");
  await expect(win.getByTestId("rail")).toHaveAttribute("data-collapsed", "false");
  await app.close();
});
