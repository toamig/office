/** The part of an Electron key event that decides what a key does. */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type KeyAction =
  | { kind: "allow" }
  /** Interface zoom: a step of 10 percent up or down, or back to 100. */
  | { kind: "zoom"; step: 1 | -1 | 0 }
  /** Opens developer tools (development runs only). */
  | { kind: "devtools" };

/**
 * The only keys the main process takes (plan 12.1): Office's interface zoom, and F12 for developer tools in
 * development runs. With no application menu there are no reload, print, save, new-window or developer-tool
 * accelerators at all, so nothing is blocked here: this runs before the page, and blocking Ctrl+R, Ctrl+W,
 * Ctrl+U, Ctrl+O, Ctrl+P or Ctrl+N would take them from the programs running in terminals.
 */
export function classifyKey(input: KeyInput, development: boolean): KeyAction {
  if (input.type !== "keyDown") return { kind: "allow" };
  const key = input.key.toLowerCase();
  const mod = input.control || input.meta;
  if (development) {
    if (key === "f12") return { kind: "devtools" };
    if (mod && input.shift && (key === "i" || key === "j")) return { kind: "devtools" };
  }
  if (!mod || input.alt) return { kind: "allow" };
  if (key === "=" || key === "+") return { kind: "zoom", step: 1 };
  if (key === "-" || key === "_") return { kind: "zoom", step: -1 };
  if (key === "0") return { kind: "zoom", step: 0 };
  return { kind: "allow" };
}

export const ZOOM_MIN = 80;
export const ZOOM_MAX = 150;
export const ZOOM_STEP = 10;

/** The next interface zoom in percent after a step, kept between 80 and 150. */
export function nextZoom(current: number, step: 1 | -1 | 0): number {
  if (step === 0) return 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + step * ZOOM_STEP));
}
