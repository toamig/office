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
      <div className="dialog w-[460px]" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <span className="font-semibold">Keyboard shortcuts</span>
          <Button variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={14} />
          </Button>
        </header>
        <div className="max-h-[70vh] overflow-auto p-4 text-selectable">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center gap-3 py-1">
              <span className="flex-1">{s.label}</span>
              <kbd className="kbd">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
