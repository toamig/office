import { describe, expect, it } from "vitest";
import { appShortcut, terminalKeyAction, type KeyLike } from "../../src/renderer/src/lib/keys";

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  type: "keydown",
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});
const ctrl = (key: string, mods: Partial<KeyLike> = {}): KeyLike =>
  k(key, { ctrlKey: true, ...mods });

describe("what a key does in a terminal", () => {
  it("sends every plain Ctrl+letter to the program, including the ones Office uses elsewhere", () => {
    for (const letter of "abdefghijklmnopqrstuwxyz") {
      if (letter === "c" || letter === "v") continue;
      expect(terminalKeyAction(ctrl(letter), false), letter).toBe("program");
    }
    for (const letter of ["k", "b", "f", "r", "w", "u", "o", "p", "n"]) {
      expect(terminalKeyAction(ctrl(letter), true), letter).toBe("program");
    }
  });

  it("copies on Ctrl+C only with a selection, otherwise it is the program's interrupt", () => {
    expect(terminalKeyAction(ctrl("c"), true)).toBe("copy");
    expect(terminalKeyAction(ctrl("c"), false)).toBe("program");
    expect(terminalKeyAction(ctrl("C", { shiftKey: true }), false)).toBe("copy");
    expect(terminalKeyAction(ctrl("C", { shiftKey: true }), true)).toBe("copy");
  });

  it("pastes on Ctrl+V and Ctrl+Shift+V", () => {
    expect(terminalKeyAction(ctrl("v"), false)).toBe("paste");
    expect(terminalKeyAction(ctrl("V", { shiftKey: true }), false)).toBe("paste");
  });

  it("leaves only the keys no terminal program needs to Office", () => {
    for (const d of "123456789") expect(terminalKeyAction(ctrl(d), false)).toBe("app");
    for (const other of ["/", ",", "=", "-", "0"])
      expect(terminalKeyAction(ctrl(other), false)).toBe("app");
    expect(terminalKeyAction(ctrl("A", { shiftKey: true }), false)).toBe("app");
    expect(terminalKeyAction(ctrl("F", { shiftKey: true }), false)).toBe("app");
    expect(terminalKeyAction(k("ArrowLeft", { altKey: true }), false)).toBe("app");
    expect(terminalKeyAction(k("ArrowRight", { altKey: true }), false)).toBe("app");
  });

  it("sends ordinary typing, Alt combinations and key releases on to the program", () => {
    expect(terminalKeyAction(k("a"), false)).toBe("program");
    expect(terminalKeyAction(k("Enter"), false)).toBe("program");
    expect(terminalKeyAction(ctrl("b", { altKey: true }), false)).toBe("program");
    expect(terminalKeyAction({ ...ctrl("c"), type: "keyup" }, true)).toBe("program");
  });

  it("copies and pastes with Cmd on a Mac, where Ctrl is the program's", () => {
    expect(terminalKeyAction(k("c", { metaKey: true }), true)).toBe("copy");
    expect(terminalKeyAction(k("c", { metaKey: true }), false)).toBe("program");
    expect(terminalKeyAction(k("v", { metaKey: true }), false)).toBe("paste");
  });
});

describe("Office's shortcuts, in and out of a terminal", () => {
  it("works everywhere for the views, the sheet, Setup, a new agent and history", () => {
    for (const inTerminal of [false, true]) {
      expect(appShortcut(ctrl("3"), inTerminal)).toEqual({ kind: "view", index: 2 });
      expect(appShortcut(ctrl("/"), inTerminal)).toEqual({ kind: "shortcuts" });
      expect(appShortcut(ctrl(","), inTerminal)).toEqual({ kind: "setup" });
      expect(appShortcut(ctrl("A", { shiftKey: true }), inTerminal)).toEqual({ kind: "new-agent" });
      expect(appShortcut(k("ArrowLeft", { altKey: true }), inTerminal)).toEqual({ kind: "back" });
      expect(appShortcut(k("ArrowRight", { altKey: true }), inTerminal)).toEqual({
        kind: "forward",
      });
    }
  });

  it("takes Ctrl+B and Ctrl+F outside a terminal and leaves them to the program inside one", () => {
    expect(appShortcut(ctrl("b"), false)).toEqual({ kind: "sidebar" });
    expect(appShortcut(ctrl("f"), false)).toEqual({ kind: "find" });
    expect(appShortcut(ctrl("b"), true)).toBeNull();
    expect(appShortcut(ctrl("f"), true)).toBeNull();
    expect(appShortcut(ctrl("k"), true)).toBeNull();
  });

  it("finds in a terminal with Ctrl+Shift+F", () => {
    expect(appShortcut(ctrl("F", { shiftKey: true }), true)).toEqual({ kind: "find" });
    expect(appShortcut(ctrl("F", { shiftKey: true }), false)).toBeNull();
  });

  it("binds nothing else", () => {
    for (const letter of ["w", "r", "u", "o", "p", "n", "s", "k"]) {
      expect(appShortcut(ctrl(letter), false)).toBeNull();
    }
    expect(appShortcut(k("a"), false)).toBeNull();
    expect(appShortcut({ ...ctrl("b"), type: "keyup" }, false)).toBeNull();
  });
});
