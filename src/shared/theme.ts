/**
 * The look of Office, in one place. The renderer turns a palette into CSS variables, the main process
 * uses the same values for the window background and the native title bar buttons, and the terminals
 * build their theme from it, so nothing has a colour of its own (plan 12.1).
 */

export type ThemeName = "light" | "dark";
export type ThemeSetting = "system" | "light" | "dark";

export interface Palette {
  /** The page behind everything. */
  bg: string;
  /** Panels, the top bar, terminals. */
  panel: string;
  /** The sidebar. */
  rail: string;
  /** Hairlines. */
  line: string;
  text: string;
  muted: string;
  /** Hover and selected rows. */
  hover: string;
  /** The default accent; the owner can pick another. */
  accent: string;
  /** Text on an accent background. */
  onAccent: string;
  good: string;
  warn: string;
  bad: string;
  /** Selected text. */
  selection: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    bg: "#f7f7f6",
    panel: "#ffffff",
    rail: "#efefed",
    line: "#e0e0dc",
    text: "#1d1d1b",
    muted: "#6a6a66",
    hover: "#e9e9e6",
    accent: "#3b6fd4",
    onAccent: "#ffffff",
    good: "#2a8a4f",
    warn: "#b87a0c",
    bad: "#c43d3d",
    selection: "#cfe0ff",
  },
  dark: {
    bg: "#171716",
    panel: "#1f1f1e",
    rail: "#131312",
    line: "#2d2d2b",
    text: "#e9e9e6",
    muted: "#9b9b96",
    hover: "#2a2a28",
    accent: "#5b8def",
    onAccent: "#ffffff",
    good: "#4cb36f",
    warn: "#d9a13a",
    bad: "#e06a6a",
    selection: "#2f4a7a",
  },
};

/** The height of the top bar, which is also the height of the native window buttons. */
export const TITLE_BAR_HEIGHT = 40;

/** Which of the two palettes to show, given the owner's setting and the system's colour scheme. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): ThemeName {
  if (setting === "system") return systemDark ? "dark" : "light";
  return setting;
}

/** The colours the native window buttons and the window background take from a theme. */
export function chromeColors(theme: ThemeName): {
  background: string;
  overlayColor: string;
  overlaySymbol: string;
} {
  const p = PALETTES[theme];
  return { background: p.bg, overlayColor: p.panel, overlaySymbol: p.text };
}

/** The CSS custom properties of a palette, as `--name` to value. */
export function paletteVariables(theme: ThemeName, accent?: string): Record<string, string> {
  const p = PALETTES[theme];
  return {
    "--bg": p.bg,
    "--panel": p.panel,
    "--rail": p.rail,
    "--line": p.line,
    "--text": p.text,
    "--muted": p.muted,
    "--hover": p.hover,
    "--accent": accent ?? p.accent,
    "--on-accent": p.onAccent,
    "--good": p.good,
    "--warn": p.warn,
    "--bad": p.bad,
    "--selection": p.selection,
  };
}
