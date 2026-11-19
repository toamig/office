import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTES, type Palette, type ThemeName } from "../../src/shared/theme";

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
/** `fg` mixed into `bg` at `share`, as color-mix does for a badge tint. */
const mix = (fg: string, bg: string, share: number): string =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(
        parseInt(fg.slice(i, i + 2), 16) * share + parseInt(bg.slice(i, i + 2), 16) * (1 - share),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const THEMES: ThemeName[] = ["light", "dark"];

describe("the contrast of the text tokens", () => {
  for (const theme of THEMES) {
    const p: Palette = PALETTES[theme];
    const surfaces: Array<[string, string]> = [
      ["bg", p.bg],
      ["panel", p.panel],
      ["overlay", p.overlay],
      ["rail", p.rail],
    ];

    it(`${theme}: primary text is at least 7:1 and secondary text at least 4.5:1 on every surface`, () => {
      for (const [name, bg] of surfaces) {
        expect(ratio(p.text, bg), `text on ${name}`).toBeGreaterThanOrEqual(7);
        expect(ratio(p.muted, bg), `muted on ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: the accent reads as a link and text on it is readable`, () => {
      expect(ratio(p.accent, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.accent, p.panel)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: each status colour is readable as the text of its own badge`, () => {
      const tones: Array<[string, string, string]> = [
        ["success", p.success, p.successFg],
        ["attention", p.attention, p.attentionFg],
        ["danger", p.danger, p.dangerFg],
        ["info", p.info, p.infoFg],
        ["neutral", p.muted, p.muted],
      ];
      for (const [name, base, fg] of tones) {
        for (const surface of [p.panel, p.bg, p.overlay]) {
          expect(
            ratio(fg, mix(base, surface, 0.14)),
            `${name} badge on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${theme}: faint text is only for disabled things and stays visible`, () => {
      expect(ratio(p.faint, p.panel)).toBeGreaterThanOrEqual(3);
      expect(ratio(p.faint, p.panel)).toBeLessThan(ratio(p.muted, p.panel));
    });

    it(`${theme}: an attention count pill is readable`, () => {
      expect(ratio(p.bg, p.attention)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// ---- the audit of views ----

const renderer = resolve(__dirname, "../../src/renderer/src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const rel = (f: string): string => relative(renderer, f).replaceAll("\\", "/");
/** Every view and shared component: all of the renderer's code except the design system itself and its Gallery. */
const checked = files(renderer).filter(
  (f) => /\.tsx$/.test(f) && !f.startsWith(join(renderer, "ui")) && !f.endsWith("Gallery.tsx"),
);

/** The places where a file breaks a rule, as "file:line", so a failure names them. */
function hits(re: RegExp, list = checked): string[] {
  const found: string[] = [];
  for (const f of list) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line)) found.push(`${rel(f)}:${i + 1}`);
      });
  }
  return found;
}

describe("the audit of views (plan DesignSystem, M10.3)", () => {
  it("never lets a view use a font size or a spacing that is not a token", () => {
    expect(
      hits(
        /\btext-\[\d+(\.\d+)?px\]|\bfontSize:\s*\d+|\b(?:p|px|py|m|mx|my|gap)-\[\d+(\.\d+)?px\]/,
      ),
    ).toEqual([]);
  });

  it("never styles an element with a colour, background, border or font of its own", () => {
    expect(hits(/style=\{\{[^}]*\b(color|background|border\w*|font\w*)\b/)).toEqual([]);
  });

  it("has no capitals as decoration, and no meta strings joined with middle dots", () => {
    expect(hits(/\buppercase\b|\btracking-/)).toEqual([]);
    expect(hits(/\u00b7|&middot;/)).toEqual([]);
  });

  it("draws no inline error bar: an action result is a notification", () => {
    // The facade in components/ui.tsx turns a message into a notification; a view must not draw its own bar.
    expect(
      hits(
        /<ErrorBanner\b/,
        checked.filter((f) => !f.endsWith("components/ui.tsx")),
      ),
    ).toEqual([]);
  });

  it("keeps the design system components themselves free of one-off sizes", () => {
    const own = files(join(renderer, "ui")).filter((f) => /\.tsx$/.test(f));
    expect(hits(/\bfontSize:\s*\d+|\btext-\[\d+(\.\d+)?px\]/, own)).toEqual([]);
  });
});
