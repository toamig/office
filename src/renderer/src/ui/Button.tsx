import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ControlSize;
};

/** The one button: primary (one per view), secondary, ghost and danger, at 28 or 32 px. */
export function Button({ variant = "secondary", size = "md", className = "", ...props }: Props) {
  return (
    <button
      type="button"
      className={`ui-btn ${className}`}
      data-variant={variant}
      data-size={size}
      {...props}
    />
  );
}

/** An icon with no text always says what it does: a tooltip and an accessible name. */
export function IconButton({
  label,
  children,
  variant = "ghost",
  size = "md",
  ...props
}: Omit<Props, "aria-label" | "title"> & { label: string; children: ReactNode }) {
  return (
    <Button
      variant={variant}
      size={size}
      className="ui-iconbtn"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}
