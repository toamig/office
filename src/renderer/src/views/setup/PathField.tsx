import { FolderOpen } from "lucide-react";
import { Button } from "../../components/ui";
import { office } from "../../lib/ipc";

export const fieldClass = "flex-1";
export /** A labelled text field for a folder, with a Browse button that opens the system folder picker. */
function PathField({
  label,
  value,
  onChange,
  testId,
  pickTitle,
  onCommit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  pickTitle: string;
  /** The value is final: Enter, leaving the field, or a folder picked with Browse. */
  onCommit?: (value: string) => void;
}) {
  return (
    <label className="mb-2 flex items-center gap-2">
      <span className="w-40">{label}</span>
      <input
        className={fieldClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit?.(value);
        }}
        onBlur={(e) => {
          // Moving to the buttons that belong to the field (Save, Undo) is not leaving it.
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-field-action]")) return;
          onCommit?.(value);
        }}
        data-testid={testId}
        aria-label={label}
      />
      <Button
        type="button"
        onClick={() =>
          void office.invoke("setup.pickFolder", { title: pickTitle }).then((p) => {
            if (!p) return;
            onChange(p);
            onCommit?.(p);
          })
        }
      >
        <FolderOpen size={13} /> Browse
      </Button>
    </label>
  );
}
