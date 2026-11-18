import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTES, terminalTheme } from "../../src/shared/theme";

const renderer = resolve(__dirname, "../../src/renderer/src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the token audit", () => {
  it("has no colour of its own in a component or in the stylesheet", () => {
    const offenders: string[] = [];
    for (const file of files(renderer)) {
      if (!/\.(tsx?|css)$/.test(file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (
            /#[0-9a-fA-F]{3,8}\b/.test(line) ||
            /\brgba?\(|\bhsla?\(/.test(line) ||
            /\bbg-black|\btext-white|\bbg-white/.test(line)
          ) {
            offenders.push(`${file.slice(renderer.length + 1)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("terminal themes", () => {
  it("has the panel's background, the text colour and all sixteen ANSI colours in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const t = terminalTheme(theme);
      expect(t["background"]).toBe(PALETTES[theme].panel);
      expect(t["foreground"]).toBe(PALETTES[theme].text);
      const ansi = [
        "black",
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
        "white",
        "brightBlack",
        "brightRed",
        "brightGreen",
        "brightYellow",
        "brightBlue",
        "brightMagenta",
        "brightCyan",
        "brightWhite",
      ];
      for (const name of ansi) expect(t[name], `${theme} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(terminalTheme("light")["background"]).not.toBe(terminalTheme("dark")["background"]);
    expect(terminalTheme("dark", "#ff0000")["cursor"]).toBe("#ff0000");
  });

  it("keeps the foreground readable on the background in both themes", () => {
    const lum = (hex: string): number => {
      const v = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * (v[0] ?? 0) + 0.7152 * (v[1] ?? 0) + 0.0722 * (v[2] ?? 0);
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    };
    for (const theme of ["light", "dark"] as const) {
      const p = PALETTES[theme];
      expect(ratio(p.text, p.panel)).toBeGreaterThan(7);
      expect(ratio(p.muted, p.panel)).toBeGreaterThan(4.5);
      expect(ratio(p.text, p.bg)).toBeGreaterThan(7);
    }
  });
});
