/**
 * The look of Office, in one place. The renderer turns a palette into CSS variables, the main process
 * uses the same values for the window background and the native title bar buttons, and the terminals
 * build their theme from it, so nothing has a colour of its own (plan 12.1).
 */

export type ThemeName = "light" | "dark";
export type ThemeSetting = "system" | "light" | "dark";

export interface Palette {
  /** The page behind everything (Graphite in dark). */
  bg: string;
  /** Raised surfaces: panels, cards, the top bar, terminals (Slate in dark). */
  panel: string;
  /** The sidebar. */
  rail: string;
  /** Menus, dialogs and popovers, a step above the panels. */
  overlay: string;
  /** Hairlines and dividers (Seam in dark). */
  line: string;
  /** Primary text (Paper in dark). */
  text: string;
  /** Secondary text. */
  muted: string;
  /** Only for disabled things and placeholders: below 4.5:1 by design. */
  faint: string;
  /** Row hover. */
  hover: string;
  /** Selected rows and the current item. */
  selected: string;
  /** The default accent (Iris); the owner can pick another. */
  accent: string;
  /** Text on an accent background. */
  onAccent: string;
  /** Status colours, kept apart from the accent: success, attention, danger and info/working. */
  success: string;
  attention: string;
  danger: string;
  info: string;
  /** The status colours as text on their own soft tint (a badge), each at least 4.5:1 there. */
  successFg: string;
  attentionFg: string;
  dangerFg: string;
  infoFg: string;
  /** Selected text. */
  selection: string;
}

/** Warm greys with one cool accent: Iris is deliberately not the Claude app's clay orange (plan DesignSystem 1.1). */
export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    bg: "#f6f4f0",
    panel: "#ffffff",
    rail: "#eeebe5",
    overlay: "#ffffff",
    line: "#ddd9d1",
    text: "#1f1e1c",
    muted: "#5e5b56",
    faint: "#8c8983",
    hover: "#ece9e3",
    selected: "#e1e3f6",
    accent: "#4a5bd6",
    onAccent: "#ffffff",
    success: "#1b7444",
    attention: "#8f5e00",
    danger: "#b3342d",
    info: "#1d6a8e",
    successFg: "#176a3c",
    attentionFg: "#7d5200",
    dangerFg: "#a52f29",
    infoFg: "#1a6283",
    selection: "#cfd5f7",
  },
  dark: {
    bg: "#1e1d1b",
    panel: "#282725",
    rail: "#232220",
    overlay: "#2f2e2b",
    line: "#3a3835",
    text: "#ecebe6",
    muted: "#b2b0ac",
    faint: "#807e7a",
    hover: "#32312e",
    selected: "#3e4155",
    accent: "#8e9bff",
    onAccent: "#14131a",
    success: "#5dbb82",
    attention: "#e3b04b",
    danger: "#e5675f",
    info: "#6fb4d8",
    successFg: "#66c58b",
    attentionFg: "#e3b04b",
    dangerFg: "#f2958f",
    infoFg: "#6fb4d8",
    selection: "#3e4472",
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
    "--raised": p.panel,
    "--rail": p.rail,
    "--overlay": p.overlay,
    "--line": p.line,
    "--text": p.text,
    "--muted": p.muted,
    "--faint": p.faint,
    "--hover": p.hover,
    "--selected": p.selected,
    "--accent": accent ?? p.accent,
    "--on-accent": p.onAccent,
    "--success": p.success,
    "--attention": p.attention,
    "--danger": p.danger,
    "--info": p.info,
    "--success-fg": p.successFg,
    "--attention-fg": p.attentionFg,
    "--danger-fg": p.dangerFg,
    "--info-fg": p.infoFg,
    // The older names, kept so views that still use them follow the new palette.
    "--good": p.success,
    "--warn": p.attention,
    "--bad": p.danger,
    "--selection": p.selection,
  };
}

/** The ANSI palettes of the two themes (the 16 colours a terminal program can ask for). */
const ANSI: Record<ThemeName, Record<string, string>> = {
  dark: {
    black: "#3b3b38",
    red: "#e06a6a",
    green: "#5fbf80",
    yellow: "#d9b45a",
    blue: "#6f9cf0",
    magenta: "#c586e0",
    cyan: "#5cc4cf",
    white: "#d8d8d4",
    brightBlack: "#6d6d68",
    brightRed: "#f08a8a",
    brightGreen: "#7fd69c",
    brightYellow: "#ebca7c",
    brightBlue: "#93b6f7",
    brightMagenta: "#d9a5ee",
    brightCyan: "#85d9e2",
    brightWhite: "#f4f4f1",
  },
  light: {
    black: "#2b2b28",
    red: "#c43d3d",
    green: "#2a8a4f",
    yellow: "#9a6b00",
    blue: "#2f5fc4",
    magenta: "#9a3fb5",
    cyan: "#157f8c",
    white: "#8a8a85",
    brightBlack: "#5a5a56",
    brightRed: "#d9534f",
    brightGreen: "#3a9d5e",
    brightYellow: "#b07f00",
    brightBlue: "#4577d9",
    brightMagenta: "#b457d1",
    brightCyan: "#2796a4",
    brightWhite: "#b8b8b3",
  },
};

/**
 * The xterm.js theme of a palette: the same background as the panel around the terminal, the text colour,
 * the cursor in the accent, and the theme's 16 ANSI colours.
 */
export function terminalTheme(theme: ThemeName, accent?: string): Record<string, string> {
  const p = PALETTES[theme];
  return {
    background: p.panel,
    foreground: p.text,
    cursor: accent ?? p.accent,
    cursorAccent: p.panel,
    selectionBackground: p.selection,
    selectionInactiveBackground: p.hover,
    ...ANSI[theme],
  };
}
