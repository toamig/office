import { FolderOpen } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Button } from "./Button";

export type FieldState = "normal" | "error" | "unsaved";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  /** One line saying what the setting does. */
  helper?: ReactNode;
  /** A form error sits under its field. */
  error?: string | null;
  /** The value differs from the saved one. */
  unsaved?: boolean;
}

/** A text field: a label above, one line of help or the error below, and an unsaved state. */
export function Input({ label, helper, error, unsaved, className = "", ...props }: FieldProps) {
  const id = useId();
  const state: FieldState = error ? "error" : unsaved ? "unsaved" : "normal";
  return (
    <div className={`ui-field ${className}`} data-state={state}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} {...props} />
      {(error || helper) && <span className="ui-helper">{error ?? helper}</span>}
    </div>
  );
}

/** A field for a folder with a Browse button; the same states as Input. */
export function PathField({ onBrowse, ...props }: FieldProps & { onBrowse?: () => void }) {
  return (
    <div className="flex items-end gap-2">
      <Input className="flex-1" {...props} />
      <Button onClick={onBrowse}>
        <FolderOpen size={14} /> Browse
      </Button>
    </div>
  );
}
