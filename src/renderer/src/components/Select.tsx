import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Option {
  value: string;
  label: string;
  disabled: boolean;
}

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
};

/** The <option> elements among the children, however they are nested in fragments or lists. */
function optionsOf(children: ReactNode): Option[] {
  const found: Option[] = [];
  const walk = (node: ReactNode): void => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const el = child as ReactElement<{
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
      }>;
      if (el.type === "option") {
        const label = textOf(el.props.children);
        found.push({
          value: el.props.value !== undefined ? String(el.props.value) : label,
          label,
          disabled: el.props.disabled === true,
        });
      } else walk(el.props.children);
    });
  };
  walk(children);
  return found;
}

export interface SelectProps {
  value?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

/**
 * Office's own dropdown: a button that shows the choice and a menu under it, with the keyboard (arrows,
 * Enter, Esc, typing a letter) and none of the browser's form-control look. It takes the same <option>
 * children as a <Select> and reports the choice as event.target.value.
 */
export function Select({
  value,
  onChange,
  children,
  className = "",
  style,
  disabled,
  title,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: SelectProps) {
  const options = useMemo(() => optionsOf(children), [children]);
  const selected = String(value ?? "");
  const current = options.find((o) => o.value === selected);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState({ left: 0, top: 0, width: 0, above: false });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const choose = (option: Option | undefined): void => {
    if (!option || option.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (option.value !== selected) onChange?.({ target: { value: option.value } });
  };

  const openMenu = (): void => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const height = Math.min(280, options.length * 28 + 10);
    const above = rect.bottom + height + 8 > window.innerHeight && rect.top > height;
    setPlace({
      left: rect.left,
      top: above ? rect.top - 4 : rect.bottom + 4,
      width: rect.width,
      above,
    });
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === selected),
      ),
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    const close = (): void => setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const step = (by: number): void => {
    const count = options.length;
    if (count === 0) return;
    let next = active;
    for (let i = 0; i < count; i++) {
      next = (next + by + count) % count;
      if (!options[next]?.disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      return setOpen(false);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      return step(e.key === "ArrowDown" ? 1 : -1);
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) return openMenu();
      return choose(options[active]);
    }
    if (e.key === "Home" && open) {
      e.preventDefault();
      return setActive(0);
    }
    if (e.key === "End" && open) {
      e.preventDefault();
      return setActive(options.length - 1);
    }
    if (e.key === "Tab") return setOpen(false);
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing a few letters jumps to the option that starts with them.
      const now = Date.now();
      const text =
        now - typed.current.at > 700
          ? e.key.toLowerCase()
          : typed.current.text + e.key.toLowerCase();
      typed.current = { text, at: now };
      const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text));
      if (hit >= 0) {
        if (open) setActive(hit);
        else choose(options[hit]);
      }
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        data-testid={testId}
        data-value={selected}
        className={`select ${className}`}
        style={style}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="select-label">{current?.label ?? ""}</span>
        <ChevronDown size={13} className="select-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            className="select-menu"
            data-testid="select-menu"
            style={{
              left: place.left,
              minWidth: place.width,
              ...(place.above ? { bottom: window.innerHeight - place.top } : { top: place.top }),
            }}
          >
            {options.map((o, i) => (
              <div
                key={`${o.value}-${i}`}
                role="option"
                aria-selected={o.value === selected}
                aria-disabled={o.disabled}
                data-index={i}
                data-value={o.value}
                data-active={i === active}
                className="select-option"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                <span className="select-check">{o.value === selected && <Check size={13} />}</span>
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
