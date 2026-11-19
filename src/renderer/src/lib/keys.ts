/** The part of a keyboard event that decides what a key does. */
export interface KeyLike {
  type?: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * What a key does while a terminal has focus (plan 12.1). The program in the terminal comes first: shells and
 * Claude Code use most Ctrl+letter keys. Only keys no terminal program needs stay Office's, and the clipboard
 * works as in Windows Terminal.
 * - "copy": Ctrl+C with text selected (the selection is cleared after), and Ctrl+Shift+C.
 * - "paste": Ctrl+V and Ctrl+Shift+V (through term.paste, so bracketed paste is kept).
 * - "app": Office's own (the views, Ctrl+/, Ctrl+, , Ctrl+Shift+A, Ctrl+Shift+T, find as Ctrl+Shift+F, zoom, Alt+arrows).
 * - "program": everything else, sent to the program as typed.
 */
export type TerminalKey = "program" | "app" | "copy" | "paste";

export function terminalKeyAction(e: KeyLike, hasSelection: boolean): TerminalKey {
  if (e.type !== undefined && e.type !== "keydown") return "program";
  const key = e.key.toLowerCase();
  // Cmd on a Mac copies and pastes; Ctrl there is for the program.
  if (e.metaKey && !e.ctrlKey && !e.altKey) {
    if (key === "c" && hasSelection) return "copy";
    if (key === "v") return "paste";
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && (key === "arrowleft" || key === "arrowright"))
    return "app";
  if (!e.ctrlKey || e.altKey) return "program";

  if (e.shiftKey) {
    if (key === "c") return "copy";
    if (key === "v") return "paste";
    if (key === "f" || key === "a" || key === "b" || key === "t" || key === "n") return "app";
    if (key === "+" || key === "_") return "app"; // zoom
    return "program";
  }
  if (key === "c") return hasSelection ? "copy" : "program";
  if (key === "v") return "paste";
  if (
    /^[1-9]$/.test(key) ||
    key === "/" ||
    key === "," ||
    key === "=" ||
    key === "-" ||
    key === "0"
  ) {
    return "app";
  }
  return "program";
}

/** What an Office shortcut asks for. */
export type AppShortcut =
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "shortcuts" }
  | { kind: "setup" }
  | { kind: "sidebar" }
  | { kind: "inspector" }
  | { kind: "new-agent" }
  | { kind: "find" }
  | { kind: "reopen-panel" }
  | { kind: "new-incognito" }
  | { kind: "view"; index: number };

/**
 * Office's own shortcuts. In a terminal only the keys the terminal policy gives to the app are Office's, so
 * Ctrl+K, Ctrl+B and Ctrl+F reach the program there (find is Ctrl+Shift+F).
 */
export function appShortcut(e: KeyLike, inTerminal: boolean): AppShortcut | null {
  if (e.type !== undefined && e.type !== "keydown") return null;
  const key = e.key.toLowerCase();
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (key === "arrowleft") return { kind: "back" };
    if (key === "arrowright") return { kind: "forward" };
    return null;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return null;
  if (inTerminal && terminalKeyAction(e, false) !== "app") return null;
  if (key === "/") return { kind: "shortcuts" };
  if (key === ",") return { kind: "setup" };
  if (key === "a" && e.shiftKey) return { kind: "new-agent" };
  if (key === "t" && e.shiftKey) return { kind: "reopen-panel" };
  if (key === "n" && e.shiftKey) return { kind: "new-incognito" };
  if (key === "f")
    return inTerminal
      ? e.shiftKey
        ? { kind: "find" }
        : null
      : e.shiftKey
        ? null
        : { kind: "find" };
  if (key === "b") return e.shiftKey ? { kind: "inspector" } : { kind: "sidebar" };
  const digit = Number(e.key);
  if (Number.isInteger(digit) && digit >= 1 && digit <= 9)
    return { kind: "view", index: digit - 1 };
  return null;
}
