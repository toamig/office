import { FolderOpen } from "lucide-react";
import { Button } from "../../components/ui";
import { office } from "../../lib/ipc";

export const fieldClass = "rounded border px-2 py-1 flex-1";
export const fieldStyle = {
  borderColor: "var(--line)",
  background: "var(--bg)",
  color: "var(--text)",
};

/** A labelled text field for a folder, with a Browse button that opens the system folder picker. */
export function PathField({
  label,
  value,
  onChange,
  testId,
  pickTitle,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  pickTitle: string;
}) {
  return (
    <label className="mb-2 flex items-center gap-2">
      <span className="w-40">{label}</span>
      <input
        className={fieldClass}
        style={fieldStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        aria-label={label}
      />
      <Button
        type="button"
        onClick={() =>
          void office.invoke("setup.pickFolder", { title: pickTitle }).then((p) => p && onChange(p))
        }
      >
        <FolderOpen size={13} /> Browse
      </Button>
    </label>
  );
}
