import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launch } from "./helpers";

// These run against the packaged app (npm run dist first): developer tools stay on in a development run.
// Set OFFICE_E2E_DEV=1 to try them against the development build.
const packaged = !process.env["OFFICE_E2E_DEV"];

/**
 * Sends a key the way the operating system does, through the window's own input path, so the main process's
 * key filter sees it (a key injected through the page's debugger never reaches that filter).
 */
async function press(app: ElectronApplication, keyCode: string, modifiers: string[] = []) {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers }) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents;
      const mods = modifiers as Array<"control" | "shift" | "alt">;
      wc?.sendInputEvent({ type: "keyDown", keyCode, modifiers: mods });
      wc?.sendInputEvent({ type: "keyUp", keyCode, modifiers: mods });
    },
    { keyCode, modifiers },
  );
}

async function ready(app: ElectronApplication): Promise<Page> {
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  return win;
}

test("the browser keys do nothing, a dropped file stays out, and the interface zoom is Office's own", async () => {
  const { app } = await launch({ world: true, fakeTools: true, packaged });
  const win = await ready(app);
  await win.evaluate(() => {
    const w = window as unknown as { __marker: number; __seen: string[] };
    w.__marker = 42;
    w.__seen = [];
    window.addEventListener("keydown", (e) => w.__seen.push(e.key));
  });
  const marker = (): Promise<number | undefined> =>
    win.evaluate(() => (window as unknown as { __marker?: number }).__marker);
  const seen = (): Promise<string[]> =>
    win.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  const windows = (): Promise<number> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

  // Reload, hard reload, print, save, new window, close window, view source: none of them is delivered.
  const blocked: Array<[string, string[]]> = [
    ["F5", []],
    ["R", ["control"]],
    ["R", ["control", "shift"]],
    ["P", ["control"]],
    ["S", ["control"]],
    ["N", ["control"]],
    ["N", ["control", "shift"]],
    ["W", ["control"]],
    ["U", ["control"]],
  ];
  if (packaged) blocked.push(["I", ["control", "shift"]], ["J", ["control", "shift"]], ["F12", []]);
  for (const [code, mods] of blocked) await press(app, code, mods);
  await new Promise((r) => setTimeout(r, 600));
  expect(await seen()).toEqual([]);
  expect(await marker()).toBe(42);
  expect(await windows()).toBe(1);
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.isDevToolsOpened(),
    ),
  ).toBe(false);

  // A key that is not blocked still arrives (the filter is not just dropping everything).
  await press(app, "K", ["control"]);
  await expect.poll(seen).toContain("k");

  // Dropping a file on the window does not take the app to the file.
  const prevented = await win.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "note.txt", { type: "text/plain" }));
    const over = new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true });
    document.body.dispatchEvent(over);
    const drop = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
    document.body.dispatchEvent(drop);
    return [over.defaultPrevented, drop.defaultPrevented];
  });
  expect(prevented).toEqual([true, true]);
  expect(win.url()).toMatch(/index\.html|localhost/);
  expect(await marker()).toBe(42);

  // Ctrl+= and Ctrl+0 are Office's zoom, stored in the settings and applied to the page.
  const zoom = async (): Promise<number> =>
    (await win.evaluate(() => window.office.invoke("settings.get"))).zoom;
  const factor = (): Promise<number> =>
    app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0,
    );
  await press(app, "=", ["control"]);
  await expect.poll(zoom).toBe(110);
  await expect.poll(factor).toBeCloseTo(1.1, 2);
  await press(app, "=", ["control"]);
  await expect.poll(zoom).toBe(120);
  await press(app, "-", ["control"]);
  await expect.poll(zoom).toBe(110);
  await press(app, "0", ["control"]);
  await expect.poll(zoom).toBe(100);
  await expect.poll(factor).toBeCloseTo(1, 2);
  await app.close();
});

test("select all, copy, cut, paste and undo work in a text field without an application menu", async () => {
  const { app } = await launch({ world: true, fakeTools: true, packaged });
  const win = await ready(app);
  await win.getByTestId("switcher-button").click();
  const field = win.getByPlaceholder(/jump to/i);
  await field.fill("hello");
  await field.focus();

  // Select all arrives through the window's own input path.
  await press(app, "A", ["control"]);
  const selected = await win.evaluate(() => {
    const i = document.activeElement as HTMLInputElement;
    return [i.selectionStart, i.selectionEnd];
  });
  expect(selected).toEqual([0, 5]);

  // Undo needs no clipboard: typed text is undone by Ctrl+Z through the window's own input path.
  await field.fill("");
  await field.pressSequentially("abc");
  await expect(field).toHaveValue("abc");
  await press(app, "Z", ["control"]);
  await expect(field).not.toHaveValue("abc");

  // Copy, cut and paste need the system clipboard. A session with no interactive desktop (a service, a
  // locked screen) has none, so the check is skipped there and the reason is attached to the report.
  const clipboardWorks = await app.evaluate(async ({ clipboard }) => {
    clipboard.writeText("probe");
    return (await clipboard.readText()) === "probe";
  });
  test.info().annotations.push({
    type: "clipboard",
    description: clipboardWorks
      ? "checked"
      : "unavailable in this session; copy, cut and paste not checked",
  });
  if (clipboardWorks) {
    const cdp = await win.context().newCDPSession(win);
    const command = async (name: string, key: string, vk: number): Promise<void> => {
      const common = {
        modifiers: 2,
        windowsVirtualKeyCode: vk,
        key,
        code: `Key${key.toUpperCase()}`,
      };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", commands: [name], ...common });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
    };
    await field.fill("hello");
    await field.focus();
    await press(app, "A", ["control"]);
    await command("copy", "c", 67);
    await win.keyboard.press("End");
    await command("paste", "v", 86);
    await expect(field).toHaveValue("hellohello");
    await press(app, "A", ["control"]);
    await command("cut", "x", 88);
    await expect(field).toHaveValue("");
    await command("paste", "v", 86);
    await expect(field).toHaveValue("hellohello");
  }
  await app.close();
});

test("Ctrl+/ opens the shortcuts sheet, the view keys work, and history walks back and forward", async () => {
  const { app } = await launch({ world: true, fakeTools: true, packaged });
  const win = await ready(app);
  await win.keyboard.press("Control+/");
  const sheet = win.getByTestId("shortcuts-sheet");
  await expect(sheet).toContainText("Jump to anything");
  await expect(sheet).toContainText("Ctrl+Shift+A");
  await win.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await win.keyboard.press("Control+2");
  await expect(win.getByTestId("projects")).toBeVisible();
  await win.keyboard.press("Control+,");
  await expect(win.getByTestId("topbar-title")).toHaveText("Setup");
  await win.keyboard.press("Alt+ArrowLeft");
  await expect(win.getByTestId("projects")).toBeVisible();
  await win.getByTestId("history-forward").click();
  await expect(win.getByTestId("topbar-title")).toHaveText("Setup");
  await win.getByTestId("rail-home").click();
  await win.getByTestId("sidebar-toggle").click();
  await expect(win.getByTestId("rail")).toHaveAttribute("data-collapsed", "true");
  await win.keyboard.press("Control+B");
  await expect(win.getByTestId("rail")).toHaveAttribute("data-collapsed", "false");
  await app.close();
});
