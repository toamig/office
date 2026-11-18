import { describe, expect, it } from "vitest";
import { restoreBounds, toSaved } from "../../src/main/core/window-state";
import { chromeColors, paletteVariables, PALETTES, resolveTheme } from "../../src/shared/theme";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1600, height: 900 };

describe("restoreBounds", () => {
  it("opens centred at the default size the first time", () => {
    const { bounds, maximized } = restoreBounds(undefined, [primary], primary);
    expect(bounds).toEqual({ width: 1280, height: 800, x: 320, y: 120 });
    expect(maximized).toBe(false);
  });

  it("reopens where it was left, and maximised if it was", () => {
    const saved = { x: 100, y: 80, w: 1000, h: 700, maximized: true };
    expect(restoreBounds(saved, [primary], primary)).toEqual({
      bounds: { x: 100, y: 80, width: 1000, height: 700 },
      maximized: true,
    });
  });

  it("keeps a spot on a second screen while that screen exists", () => {
    const saved = { x: 2000, y: 100, w: 1100, h: 700 };
    expect(restoreBounds(saved, [primary, second], primary).bounds.x).toBe(2000);
  });

  it("falls back to the primary screen when the saved spot is off every screen", () => {
    const saved = { x: 2000, y: 100, w: 1100, h: 700, maximized: false };
    const { bounds } = restoreBounds(saved, [primary], primary);
    expect(bounds).toEqual({ width: 1280, height: 800, x: 320, y: 120 });
    // A window with only a sliver on a screen counts as lost too.
    const sliver = { x: 1880, y: 100, w: 1100, h: 700 };
    expect(restoreBounds(sliver, [primary], primary).bounds.x).toBe(320);
  });

  it("never opens smaller than the minimum, and never bigger than a small screen", () => {
    const tiny = restoreBounds({ x: 10, y: 10, w: 200, h: 100 }, [primary], primary);
    expect(tiny.bounds).toMatchObject({ width: 900, height: 600 });
    const small = { x: 0, y: 0, width: 1024, height: 700 };
    expect(restoreBounds(undefined, [small], small).bounds).toMatchObject({
      width: 1024,
      height: 700,
    });
  });

  it("saves the normal bounds and the maximised flag", () => {
    expect(toSaved({ x: 1, y: 2, width: 3, height: 4 }, true)).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      maximized: true,
    });
  });
});

describe("themes", () => {
  it("resolves the setting against the system's scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("colours the window buttons from the same palette as the page", () => {
    for (const theme of ["light", "dark"] as const) {
      const c = chromeColors(theme);
      expect(c.background).toBe(PALETTES[theme].bg);
      expect(c.overlayColor).toBe(PALETTES[theme].panel);
      expect(c.overlaySymbol).toBe(PALETTES[theme].text);
    }
    expect(chromeColors("light").overlayColor).not.toBe(chromeColors("dark").overlayColor);
  });

  it("makes a variable for every colour, and lets the owner's accent win", () => {
    const vars = paletteVariables("dark", "#ff0000");
    expect(Object.keys(vars)).toEqual(
      expect.arrayContaining([
        "--bg",
        "--panel",
        "--rail",
        "--line",
        "--text",
        "--muted",
        "--hover",
      ]),
    );
    expect(vars["--accent"]).toBe("#ff0000");
    expect(paletteVariables("light")["--accent"]).toBe(PALETTES.light.accent);
  });
});
