import { X } from "lucide-react";
import { useEscape } from "../lib/escape";
import { SHORTCUTS } from "../lib/shortcuts";
import { useUi } from "../stores/ui";
import { Button } from "./ui";

/** The list of every shortcut, opened with Ctrl+/. */
export function ShortcutsSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  useEscape(() => setOpen(false), open);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" data-testid="shortcuts-sheet" onClick={() => setOpen(false)}>
      <div className="dialog w-[740px]" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <span className="font-semibold">Keyboard shortcuts</span>
          <Button variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={14} />
          </Button>
        </header>
        <div className="p-4 text-selectable">
          <div className="grid grid-cols-2 gap-x-8">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center gap-3 py-1">
                <span className="flex-1">{s.label}</span>
                <kbd className="kbd">{s.keys}</kbd>
              </div>
            ))}
          </div>
          <p
            className="mt-3 text-[12px]"
            style={{ color: "var(--muted)" }}
            data-testid="shortcuts-terminal-note"
          >
            While a terminal has focus, the program in it comes first: every plain Ctrl+letter goes
            to it, including Ctrl+K, Ctrl+B and Ctrl+F (a shell and Claude Code use them). There
            only Ctrl+1 to Ctrl+9, Ctrl+/, Ctrl+, , Ctrl+Shift+A, Ctrl+Shift+F, the zoom keys and
            Alt+Left / Alt+Right are Office&apos;s. Copy and paste work as in Windows Terminal:
            Ctrl+C copies when text is selected, Ctrl+V pastes.
          </p>
        </div>
      </div>
    </div>
  );
}
