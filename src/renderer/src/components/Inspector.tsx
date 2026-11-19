import { X } from "lucide-react";
import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { INSPECTOR_MAX, INSPECTOR_MIN, useInspector } from "../lib/inspector";
import { useUi, type ViewId } from "../stores/ui";
import { IconButton } from "../ui";

/** The shell's right-hand panel. Views draw their details into it with InspectorSlot. */
export function Inspector({
  view,
  width,
  onResizing,
}: {
  view: ViewId;
  width: number;
  onResizing: (width: number) => void;
}) {
  const inspector = useInspector(view);
  const setNode = useUi((s) => s.setInspectorNode);
  const [dragged, setDragged] = useState<number | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.buttons !== 1) return;
    const right = e.currentTarget.parentElement?.getBoundingClientRect().right ?? 0;
    const next = Math.round(Math.min(Math.max(right - e.clientX, INSPECTOR_MIN), INSPECTOR_MAX));
    setDragged(next);
    onResizing(next);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>): void => {
    const by = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (by === 0) return;
    e.preventDefault();
    const next = Math.min(Math.max(width + by, INSPECTOR_MIN), INSPECTOR_MAX);
    onResizing(next);
    inspector.save(next);
  };
  return (
    <aside
      className="inspector"
      aria-label="Details"
      data-testid="inspector"
      data-open={inspector.open}
      hidden={!inspector.open}
    >
      <div
        className="inspector-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the inspector"
        aria-valuenow={dragged ?? width}
        aria-valuemin={INSPECTOR_MIN}
        aria-valuemax={INSPECTOR_MAX}
        tabIndex={0}
        data-testid="inspector-resizer"
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={move}
        onPointerUp={() => {
          if (dragged !== null) inspector.save(dragged);
          setDragged(null);
        }}
        onKeyDown={keys}
      />
      <header className="inspector-head">
        <h2 className="inspector-title">Details</h2>
        <IconButton label="Hide the details (Ctrl+Shift+B)" size="sm" onClick={inspector.toggle}>
          <X />
        </IconButton>
      </header>
      <div className="inspector-body" ref={setNode} data-testid="inspector-body" />
    </aside>
  );
}

/** What a view puts in the inspector: drawn only while that view is the one showing and its inspector is open. */
export function InspectorSlot({ view, children }: { view: ViewId; children: ReactNode }) {
  const current = useUi((s) => s.view);
  const node = useUi((s) => s.inspectorNode);
  const inspector = useInspector(view);
  if (current !== view || !node || !inspector.open) return null;
  return createPortal(children, node);
}
