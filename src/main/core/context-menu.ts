/** The part of Electron's context-menu parameters the menu is built from. */
export interface MenuParams {
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

export type MenuAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "openLink"
  | "copyLink"
  | { replaceWith: string };

export interface MenuItem {
  label: string;
  action: MenuAction;
  enabled: boolean;
}

/** A separator between groups. */
export type MenuEntry = MenuItem | "separator";

const MAX_SUGGESTIONS = 5;

/**
 * What a right click shows (plan 12.1), as plain data so it can be tested: in a text field the editing
 * commands and spelling suggestions, on selected text Copy, on a link Open and Copy link, elsewhere nothing.
 */
export function buildContextMenu(p: MenuParams): MenuEntry[] {
  const out: MenuEntry[] = [];
  const group = (items: MenuItem[]): void => {
    if (items.length === 0) return;
    if (out.length > 0) out.push("separator");
    out.push(...items);
  };
  if (p.isEditable) {
    if (p.misspelledWord) {
      group(
        p.dictionarySuggestions.slice(0, MAX_SUGGESTIONS).map((word) => ({
          label: word,
          action: { replaceWith: word },
          enabled: true,
        })),
      );
    }
    group([
      { label: "Undo", action: "undo", enabled: p.editFlags.canUndo },
      { label: "Redo", action: "redo", enabled: p.editFlags.canRedo },
    ]);
    group([
      { label: "Cut", action: "cut", enabled: p.editFlags.canCut },
      { label: "Copy", action: "copy", enabled: p.editFlags.canCopy },
      { label: "Paste", action: "paste", enabled: p.editFlags.canPaste },
      { label: "Select all", action: "selectAll", enabled: p.editFlags.canSelectAll },
    ]);
  } else if (p.selectionText.trim() !== "") {
    group([{ label: "Copy", action: "copy", enabled: true }]);
  }
  if (p.linkURL) {
    group([
      { label: "Open link", action: "openLink", enabled: true },
      { label: "Copy link", action: "copyLink", enabled: true },
    ]);
  }
  return out;
}

/** A terminal's menu: Copy (when text is selected) and Paste, which the page carries out. */
export function terminalMenu(hasSelection: boolean): MenuEntry[] {
  return [
    { label: "Copy", action: "copy", enabled: hasSelection },
    { label: "Paste", action: "paste", enabled: true },
  ];
}
