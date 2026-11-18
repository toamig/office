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
  | { kind: "block" }
  /** Interface zoom: a step of 10 percent up or down, or back to 100. */
  | { kind: "zoom"; step: 1 | -1 | 0 };

/**
 * Keys that make Office feel like a web page and are turned off (plan 12.1): reload, developer tools,
 * print, save page, new window, close window or tab, view source and open file. Developer tools stay on in
 * development runs. The browser's zoom keys become Office's own interface zoom.
 */
export function classifyKey(input: KeyInput, development: boolean): KeyAction {
  if (input.type !== "keyDown") return { kind: "allow" };
  const key = input.key.toLowerCase();
  const mod = input.control || input.meta;
  if (key === "f5" || key === "f7") return { kind: "block" };
  if (key === "f12") return development ? { kind: "allow" } : { kind: "block" };
  if (!mod) return { kind: "allow" };

  if (key === "i" && (input.shift || input.alt)) {
    return development ? { kind: "allow" } : { kind: "block" };
  }
  if (key === "j" && input.shift) return development ? { kind: "allow" } : { kind: "block" };
  if (key === "r") return { kind: "block" };
  if (["p", "s", "n", "w", "u", "o"].includes(key) && !input.alt) return { kind: "block" };
  if (key === "t" && input.shift) return { kind: "block" };
  if (key === "delete" && input.shift) return { kind: "block" };

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
