import { describe, expect, it } from "vitest";
import { buildContextMenu, terminalMenu, type MenuParams } from "../../src/main/core/context-menu";
import { classifyKey, nextZoom, type KeyInput } from "../../src/main/core/keys";

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: "keyDown",
  key: k,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...mods,
});
const ctrl = (k: string, mods: Partial<KeyInput> = {}): KeyInput =>
  key(k, { control: true, ...mods });

describe("the keys the main process takes", () => {
  it("blocks nothing: with no application menu the browser's accelerators do not exist, and the programs in terminals need their keys", () => {
    for (const input of [
      key("F5"),
      ctrl("r"),
      ctrl("R", { shift: true }),
      ctrl("p"),
      ctrl("s"),
      ctrl("n"),
      ctrl("N", { shift: true }),
      ctrl("w"),
      ctrl("W", { shift: true }),
      ctrl("u"),
      ctrl("o"),
      ctrl("T", { shift: true }),
      ctrl("b"),
      ctrl("k"),
      ctrl("f"),
      key("r", { meta: true }),
      key("F7"),
    ]) {
      expect(classifyKey(input, false)).toEqual({ kind: "allow" });
      expect(classifyKey(input, true)).toEqual({ kind: "allow" });
    }
  });

  it("opens developer tools from F12 and Ctrl+Shift+I or J in development runs only", () => {
    for (const input of [key("F12"), ctrl("I", { shift: true }), ctrl("J", { shift: true })]) {
      expect(classifyKey(input, true)).toEqual({ kind: "devtools" });
      expect(classifyKey(input, false)).toEqual({ kind: "allow" });
    }
  });

  it("turns the zoom keys into interface zoom steps", () => {
    expect(classifyKey(ctrl("="), false)).toEqual({ kind: "zoom", step: 1 });
    expect(classifyKey(ctrl("+", { shift: true }), false)).toEqual({ kind: "zoom", step: 1 });
    expect(classifyKey(ctrl("-"), false)).toEqual({ kind: "zoom", step: -1 });
    expect(classifyKey(ctrl("0"), false)).toEqual({ kind: "zoom", step: 0 });
    expect(classifyKey({ ...ctrl("="), type: "keyUp" }, false)).toEqual({ kind: "allow" });
  });

  it("keeps the interface zoom between 80 and 150 percent", () => {
    expect(nextZoom(100, 1)).toBe(110);
    expect(nextZoom(150, 1)).toBe(150);
    expect(nextZoom(80, -1)).toBe(80);
    expect(nextZoom(130, 0)).toBe(100);
  });
});

const params = (over: Partial<MenuParams> = {}): MenuParams => ({
  isEditable: false,
  selectionText: "",
  linkURL: "",
  misspelledWord: "",
  dictionarySuggestions: [],
  editFlags: {
    canUndo: true,
    canRedo: false,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canSelectAll: true,
  },
  ...over,
});
const labels = (p: MenuParams): string[] =>
  buildContextMenu(p).map((e) => (e === "separator" ? "-" : e.label));

describe("the native context menu", () => {
  it("shows nothing on plain content", () => {
    expect(buildContextMenu(params())).toEqual([]);
  });

  it("shows the editing commands in a text field, with up to five spelling suggestions first", () => {
    expect(labels(params({ isEditable: true }))).toEqual([
      "Undo",
      "Redo",
      "-",
      "Cut",
      "Copy",
      "Paste",
      "Select all",
    ]);
    const misspelt = labels(
      params({
        isEditable: true,
        misspelledWord: "teh",
        dictionarySuggestions: ["the", "tech", "ten", "tea", "tee", "tehran"],
      }),
    );
    expect(misspelt.slice(0, 6)).toEqual(["the", "tech", "ten", "tea", "tee", "-"]);
    const redo = buildContextMenu(params({ isEditable: true })).find(
      (e) => e !== "separator" && e.label === "Redo",
    );
    expect(redo).toMatchObject({ enabled: false });
  });

  it("shows Copy on selected text, and the link commands on a link", () => {
    expect(labels(params({ selectionText: "some words" }))).toEqual(["Copy"]);
    expect(labels(params({ selectionText: "   " }))).toEqual([]);
    expect(labels(params({ linkURL: "https://example.com", selectionText: "x" }))).toEqual([
      "Copy",
      "-",
      "Open link",
      "Copy link",
    ]);
  });

  it("gives a terminal Copy (only with a selection) and Paste", () => {
    expect(
      terminalMenu(true).map((e) => (e === "separator" ? "-" : `${e.label}:${e.enabled}`)),
    ).toEqual(["Copy:true", "Paste:true"]);
    expect(terminalMenu(false)[0]).toMatchObject({ label: "Copy", enabled: false });
  });
});
