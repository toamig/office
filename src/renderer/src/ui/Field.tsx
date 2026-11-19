import { FolderOpen } from "lucide-react";
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
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
  /** The label is still there for screen readers but not drawn: for a field in a toolbar or a row. */
  hideLabel?: boolean;
}

/** A text field: a label above, one line of help or the error below, and an unsaved state. */
export function Input({
  label,
  helper,
  error,
  unsaved,
  hideLabel,
  className = "",
  ...props
}: FieldProps) {
  const id = useId();
  const state: FieldState = error ? "error" : unsaved ? "unsaved" : "normal";
  return (
    <div className={`ui-field ${className}`} data-state={state}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </label>
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

interface AreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  helper?: ReactNode;
  error?: string | null;
  hideLabel?: boolean;
}

/** A multi-line text field with the same label, help and error as Input. */
export function Textarea({ label, helper, error, hideLabel, className = "", ...props }: AreaProps) {
  const id = useId();
  return (
    <div className={`ui-field ${className}`} data-state={error ? "error" : "normal"}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </label>
      <textarea id={id} aria-invalid={error ? true : undefined} {...props} />
      {(error || helper) && <span className="ui-helper">{error ?? helper}</span>}
    </div>
  );
}
