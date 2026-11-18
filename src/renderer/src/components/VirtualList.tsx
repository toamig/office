import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Past this many rows a list draws only the rows near the screen. */
export const VIRTUAL_THRESHOLD = 200;

const OVERSCAN_PX = 600;

/** The nearest ancestor that scrolls, or the page. */
function scrollParent(el: HTMLElement): HTMLElement | Window {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return window;
}

/**
 * A list that draws only the rows near the screen once it is long (more than `threshold` rows), so a thousand
 * sessions, notifications, files or diff lines cost no more than twenty. Rows can be of different heights: each
 * drawn row is measured, and the rows that are not drawn count with the height of the ones that were, or with
 * `estimate`. A short list is drawn whole, as plain rows.
 */
export function VirtualList<T>({
  items,
  estimate,
  itemKey,
  renderItem,
  threshold = VIRTUAL_THRESHOLD,
  className,
  testId,
}: {
  items: T[];
  estimate: number;
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  threshold?: number;
  className?: string;
  testId?: string;
}) {
  const virtual = items.length > threshold;
  const root = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [range, setRange] = useState({ top: 0, bottom: 1200 });

  /** Which part of the list is on screen, in the list's own pixels. */
  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const parent = scrollParent(el);
    const box = el.getBoundingClientRect();
    const viewTop = parent === window ? 0 : (parent as HTMLElement).getBoundingClientRect().top;
    const viewHeight =
      parent === window ? window.innerHeight : (parent as HTMLElement).clientHeight;
    const top = Math.max(0, viewTop - box.top - OVERSCAN_PX);
    const bottom = viewTop - box.top + viewHeight + OVERSCAN_PX;
    setRange((old) => (old.top === top && old.bottom === bottom ? old : { top, bottom }));
  }, []);

  useLayoutEffect(() => {
    if (!virtual) return;
    measure();
  }, [virtual, items.length, measure]);

  useEffect(() => {
    const el = root.current;
    if (!virtual || !el) return;
    const parent = scrollParent(el);
    const onScroll = (): void => measure();
    parent.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      parent.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [virtual, measure]);

  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (!virtual) return;
    observer.current = new ResizeObserver((entries) => {
      setHeights((old) => {
        let next: Map<string, number> | null = null;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset["vkey"];
          const height = Math.round(entry.contentRect.height);
          if (key !== undefined && height > 0 && old.get(key) !== height) {
            next ??= new Map(old);
            next.set(key, height);
          }
        }
        return next ?? old;
      });
    });
    return () => observer.current?.disconnect();
  }, [virtual]);

  if (!virtual) {
    return (
      <div className={className} data-testid={testId}>
        {items.map((item, i) => (
          <div key={itemKey(item, i)}>{renderItem(item, i)}</div>
        ))}
      </div>
    );
  }

  // Row tops from the measured heights (or the estimate), and the rows that cross the visible range.
  const tops: number[] = new Array<number>(items.length + 1);
  let y = 0;
  for (let i = 0; i < items.length; i++) {
    tops[i] = y;
    y += heights.get(itemKey(items[i] as T, i)) ?? estimate;
  }
  tops[items.length] = y;
  let first = 0;
  while (first < items.length - 1 && (tops[first + 1] as number) < range.top) first++;
  let last = first;
  while (last < items.length - 1 && (tops[last] as number) < range.bottom) last++;

  return (
    <div
      ref={root}
      className={className}
      data-testid={testId}
      data-virtual="true"
      style={{ paddingTop: tops[first] as number, paddingBottom: y - (tops[last + 1] as number) }}
    >
      {items.slice(first, last + 1).map((item, offset) => {
        const index = first + offset;
        const key = itemKey(item, index);
        return (
          <div
            key={key}
            data-vkey={key}
            ref={(node) => {
              if (node) observer.current?.observe(node);
            }}
          >
            {renderItem(item, index)}
          </div>
        );
      })}
    </div>
  );
}
