import { SHORTCUTS } from "../lib/shortcuts";
import { useUi } from "../stores/ui";
import { Button, Dialog, Kbd } from "../ui";

/** The list of every shortcut, opened with Ctrl+/. */
export function ShortcutsSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <Dialog
      title="Keyboard shortcuts"
      testId="shortcuts-sheet"
      wide
      onClose={() => setOpen(false)}
      footer={<Button onClick={() => setOpen(false)}>Close</Button>}
    >
      <div className="text-selectable">
        <div className="grid grid-cols-2 gap-x-8">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center gap-3 py-1">
              <span className="flex-1">{s.label}</span>
              <Kbd>{s.keys}</Kbd>
            </div>
          ))}
        </div>
        <p
          className="ui-muted mt-3 text-[length:var(--text-xs)]"
          data-testid="shortcuts-terminal-note"
        >
          While a terminal has focus, the program in it comes first: every plain Ctrl+letter goes to
          it, including Ctrl+K, Ctrl+B and Ctrl+F (a shell and Claude Code use them). There only
          Ctrl+1 to Ctrl+9, Ctrl+/, Ctrl+, , Ctrl+Shift+A, Ctrl+Shift+F, the zoom keys and Alt+Left
          / Alt+Right are Office&apos;s. Copy and paste work as in Windows Terminal: Ctrl+C copies
          when text is selected, Ctrl+V pastes.
        </p>
      </div>
    </Dialog>
  );
}
