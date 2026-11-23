import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";

const HANDLE = 6;
const STEP = 16;

/**
 * Two panes with a draggable divider. Where the owner puts the divider is remembered per `id` on this PC
 * (the size of the first pane, in pixels), restored after a restart, and kept clear of both minimums.
 */
export function SplitPane({
  id,
  first,
  second,
  defaultSize = 320,
  min = 200,
  minSecond = 360,
  label = "Resize the panes",
  fixedSide = "left",
  showSecond = true,
  fullSecond = false,
  secondWhenNarrow = false,
}: {
  id: string;
  first: ReactNode;
  second: ReactNode;
  /** The first pane's width until the owner moves the divider. */
  defaultSize?: number;
  /** The least width of the first pane. */
  min?: number;
  /** The least width of the second pane. */
  minSecond?: number;
  label?: string;
  fixedSide?: "left" | "right";
  showSecond?: boolean;
  /** The second pane fills the whole area; the first stays mounted, out of sight. */
  fullSecond?: boolean;
  /** With no room for both panes, show only the second. */
  secondWhenNarrow?: boolean;
}) {
  const settings = useQuery("settings.get", undefined, ["settings.changed"]);
  const saved = settings.data?.panes[id];
  const [local, setLocal] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const size = local ?? saved ?? defaultSize;
  // With no room for both panes the second one takes the whole area, so its own controls stay reachable.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setNarrow(element.getBoundingClientRect().width < min + minSecond + HANDLE));
    watch.observe(element);
    return () => watch.disconnect();
  }, [min, minSecond]);

  const clamp = useCallback(
    (value: number): number => {
      const width = box.current?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
      const most = Math.max(min, width - minSecond - HANDLE);
      return Math.round(Math.min(Math.max(value, min), most));
    },
    [min, minSecond],
  );
  const save = (value: number): void => {
    void office.invoke("settings.set", { panes: { [id]: value } });
  };

  const drag = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.buttons !== 1 || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const distance = fixedSide === "right" ? rect.right - e.clientX : e.clientX - rect.left;
    setLocal(clamp(distance - HANDLE / 2));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const by = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0;
    if (by === 0) return;
    e.preventDefault();
    const next = clamp(size + (fixedSide === "right" ? -by : by));
    setLocal(next);
    save(next);
  };
  const fixed = `max(${min}px, min(${size}px, calc(100% - ${minSecond + HANDLE}px)))`;
  const flexible = "minmax(0, 1fr)";
  const full = showSecond && (fullSecond || (secondWhenNarrow && narrow));
  const columns = full ? `0px 0px ${flexible}` : !showSecond ? flexible : fixedSide === "right" ? `${flexible} ${HANDLE}px ${fixed}` : `${fixed} ${HANDLE}px ${flexible}`;
  return (
    <div
      ref={box}
      className="ui-split"
      style={{
        gridTemplateColumns: columns,
      }}
      data-testid={`split-${id}`}
    >
      <div className="ui-split-pane" style={full ? { visibility: "hidden", overflow: "hidden" } : undefined} aria-hidden={full || undefined}>{first}</div>
      {showSecond && <><div
        className="ui-split-handle"
        style={full ? { visibility: "hidden" } : undefined}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={size}
        aria-valuemin={min}
        tabIndex={0}
        data-testid={`split-${id}-divider`}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={drag}
        onPointerUp={() => local !== null && save(local)}
        onKeyDown={key}
      />
      <div className="ui-split-pane">{second}</div></>}
    </div>
  );
}
