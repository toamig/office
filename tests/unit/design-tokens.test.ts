import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

// ---- the token audit for views ----

const renderer = resolve(__dirname, "../../src/renderer/src");
const BASELINE = resolve(__dirname, "token-baseline.json");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Font sizes and spacing that are a number instead of a token: `text-[13px]`, `fontSize: 13`, `p-[7px]`. */
const NOT_A_TOKEN = [
  /\btext-\[\d+(\.\d+)?px\]/g,
  /\bfontSize:\s*\d+/g,
  /\b(?:p|px|py|m|mx|my|gap)-\[\d+(\.\d+)?px\]/g,
];

function violations(file: string): number {
  const text = readFileSync(file, "utf8");
  return NOT_A_TOKEN.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0);
}

describe("the token audit for views", () => {
  const checked = files(renderer).filter(
    (f) => /\.tsx$/.test(f) && !f.includes(`${join(renderer, "ui")}`),
  );

  it("never lets a view or a shared component use a size or spacing that is not a token, beyond the baseline that M10.3 drives to zero", () => {
    const now: Record<string, number> = {};
    for (const f of checked) {
      const n = violations(f);
      if (n > 0) now[relative(renderer, f).replaceAll("\\", "/")] = n;
    }
    if (process.env["UPDATE_TOKEN_BASELINE"] === "1") {
      writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const base = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>)
      : {};
    const worse = Object.entries(now).filter(([file, n]) => n > (base[file] ?? 0));
    expect(worse.map(([file, n]) => `${file}: ${n} (baseline ${base[file] ?? 0})`)).toEqual([]);
  });

  it("keeps the design system components themselves free of one-off sizes", () => {
    const own = files(join(renderer, "ui")).filter((f) => /\.tsx$/.test(f));
    const found = own.filter((f) =>
      /\bfontSize:\s*\d+|\btext-\[\d+(\.\d+)?px\]/.test(readFileSync(f, "utf8")),
    );
    expect(found.map((f) => relative(renderer, f))).toEqual([]);
  });
});
