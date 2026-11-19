import { useRef, type KeyboardEvent } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  testId?: string;
}

/** Tabs with arrow-key movement; the selected one is marked for assistive tools. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (e: KeyboardEvent, index: number): void => {
    const next = e.key === "ArrowRight" ? index + 1 : e.key === "ArrowLeft" ? index - 1 : null;
    if (next === null) return;
    const to = (next + items.length) % items.length;
    refs.current[to]?.focus();
    const id = items[to]?.id;
    if (id) onChange(id);
  };
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          data-testid={t.testId}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => move(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
