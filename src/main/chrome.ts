import { nativeTheme, type BrowserWindow } from "electron";
import {
  chromeColors,
  resolveTheme,
  TITLE_BAR_HEIGHT,
  type ThemeName,
  type ThemeSetting,
} from "../shared/theme";

export interface ChromeState {
  theme: ThemeName;
  background: string;
  overlayColor: string;
  overlaySymbol: string;
}

let last: ChromeState = { theme: "dark", ...toState("dark") };

function toState(theme: ThemeName): Omit<ChromeState, "theme"> {
  const c = chromeColors(theme);
  return { background: c.background, overlayColor: c.overlayColor, overlaySymbol: c.overlaySymbol };
}

/** What the window chrome was last set to (read by the app, and by tests through `app.chrome`). */
export const currentChrome = (): ChromeState => last;

/** The theme the window should start with, before any window exists. */
export function startingChrome(setting: ThemeSetting): ChromeState {
  nativeTheme.themeSource = setting;
  const theme = resolveTheme(setting, nativeTheme.shouldUseDarkColors);
  last = { theme, ...toState(theme) };
  return last;
}

/**
 * Colours the window background and the native minimise, maximise and close buttons from the theme, and tells
 * the system which colour scheme the page should see, so everything follows the setting at once.
 */
export function applyChrome(win: BrowserWindow | null, setting: ThemeSetting): ChromeState {
  const state = startingChrome(setting);
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(state.background);
    if (process.platform !== "darwin") {
      try {
        win.setTitleBarOverlay({
          color: state.overlayColor,
          symbolColor: state.overlaySymbol,
          height: TITLE_BAR_HEIGHT,
        });
      } catch {
        /* a window made without an overlay cannot take one */
      }
    }
  }
  return state;
}
