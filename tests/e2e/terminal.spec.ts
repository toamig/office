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

  // Ctrl+Shift+F opens find in the terminal under the pointer or focus, and Escape closes it.
  await win.locator(".xterm").click();
  await win.keyboard.press("Control+Shift+F");
  await expect(win.getByTestId("terminal-find-input")).toBeFocused();
  await win.getByTestId("terminal-find-input").fill("ready");
  await win.keyboard.press("Enter");
  await win.keyboard.press("Escape");
  await expect(win.getByTestId("terminal-find")).toHaveCount(0);
  await app.close();
});

/** A program in a terminal that prints the bytes it receives, in hex, one chunk per line. */
const HEX_PROGRAM =
  "process.stdin.setRawMode(true); process.stdin.resume(); console.log('HEXREADY'); process.stdin.on('data', d => console.log('HEX:' + Buffer.from(d).toString('hex')))";

async function openHexTerminal(win: import("@playwright/test").Page) {
  await win.evaluate(
    (code) =>
      window.office.invoke("sessions.startCommand", {
        title: "hex",
        cmd: "node",
        args: ["-e", code],
      }),
    HEX_PROGRAM,
  );
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "hex" }).click();
  await expect.poll(() => terminalText(win)).toContain("HEXREADY");
  await win.locator(".xterm").click();
}

test("a terminal's program gets its Ctrl keys: history search, delete word, Ctrl+B and the rest", async () => {
  const { app } = await launch({
    world: true,
    fakeTools: true,
    env: { OFFICE_ALLOW_RAW_TERMINAL: "1" },
  });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await openHexTerminal(win);

  const expected: Array<[string, string]> = [
    ["Control+r", "12"],
    ["Control+w", "17"],
    ["Control+b", "02"],
    ["Control+u", "15"],
    ["Control+o", "0f"],
    ["Control+p", "10"],
    ["Control+n", "0e"],
    ["Control+k", "0b"],
    ["Control+f", "06"],
  ];
  for (const [combo, hex] of expected) {
    await win.keyboard.press(combo);
    await expect.poll(() => terminalText(win), { message: combo }).toContain(`HEX:${hex}`);
  }
  // None of them moved the app: no switcher, no find box, the sidebar is as it was.
  await expect(win.getByTestId("terminal-find")).toHaveCount(0);
  await expect(win.getByPlaceholder(/jump to/i)).toHaveCount(0);
  await expect(win.getByTestId("rail")).toHaveAttribute("data-collapsed", "false");

  // Office's own keys still work there: Ctrl+Shift+F finds, Ctrl+2 goes to Projects.
  await win.keyboard.press("Control+Shift+F");
  await expect(win.getByTestId("terminal-find-input")).toBeFocused();
  await win.keyboard.press("Escape");
  await win.locator(".xterm").click();
  await win.keyboard.press("Control+2");
  await expect(win.getByTestId("projects")).toBeVisible();
  await app.close();
});

test("the terminal clipboard works as in Windows Terminal: Ctrl+C copies a selection, Ctrl+V pastes", async () => {
  const { app } = await launch({
    world: true,
    fakeTools: true,
    env: { OFFICE_ALLOW_RAW_TERMINAL: "1" },
  });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await openHexTerminal(win);
  // The system clipboard is not there in every session, so the page's clipboard is replaced by a stand-in.
  await win.evaluate(() => {
    const w = window as unknown as { __clip: string };
    w.__clip = "pasted words";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => w.__clip,
        writeText: async (t: string) => {
          w.__clip = t;
        },
      },
    });
  });
  const clip = (): Promise<string> =>
    win.evaluate(() => (window as unknown as { __clip: string }).__clip);

  // Ctrl+V pastes through the terminal, not as ^V.
  await win.keyboard.press("Control+v");
  const hex = Buffer.from("pasted words").toString("hex");
  await expect.poll(() => terminalText(win)).toContain(`HEX:${hex}`);
  expect(await terminalText(win)).not.toContain("HEX:16");
  await win.keyboard.press("Control+Shift+V");
  await expect.poll(async () => (await terminalText(win)).split(`HEX:${hex}`).length).toBe(3);

  // Ctrl+C with a selection copies it and clears the selection; the program gets no interrupt.
  await win.evaluate(() => {
    const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
      __term?: { select: (c: number, r: number, l: number) => void };
    };
    host.__term?.select(0, 0, 8);
  });
  const selected = await win.evaluate(() => {
    const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
      __term?: { getSelection: () => string };
    };
    return host.__term?.getSelection() ?? "";
  });
  expect(selected).toBe("HEXREADY");
  await win.keyboard.press("Control+c");
  await expect.poll(clip).toBe("HEXREADY");
  const cleared = await win.evaluate(() => {
    const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
      __term?: { hasSelection: () => boolean };
    };
    return host.__term?.hasSelection();
  });
  expect(cleared).toBe(false);
  expect(await terminalText(win)).not.toContain("HEX:03");
  // Without a selection Ctrl+C is the program's interrupt again.
  await win.keyboard.press("Control+c");
  await expect.poll(() => terminalText(win)).toContain("HEX:03");

  // Ctrl+Shift+C copies too.
  await win.evaluate(() => {
    const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
      __term?: { select: (c: number, r: number, l: number) => void };
    };
    host.__term?.select(0, 0, 3);
  });
  await win.keyboard.press("Control+Shift+C");
  await expect.poll(clip).toBe("HEX");
  await app.close();
});
