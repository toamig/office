import { useEffect, type RefObject } from "react";
import type { PreviewBounds } from "@shared/models";
import { useUi } from "../stores/ui";

export function useNativeBounds(ref: RefObject<HTMLDivElement | null>, send: (bounds: PreviewBounds) => void): void {
  const covered = useUi((state) => state.switcherOpen || state.syncReport !== null);
  useEffect(() => {
    const holder = ref.current;
    if (!holder) return;
    let last = "";
    const report = () => {
      const { x, y, width, height } = holder.getBoundingClientRect();
      const visible = !covered && !document.querySelector('[aria-modal="true"]') &&
        width > 0 && height > 0 && getComputedStyle(holder).visibility !== "hidden";
      const bounds = { x, y, width, height, visible };
      const key = JSON.stringify(bounds);
      if (key !== last) { last = key; send(bounds); }
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(holder);
    const timer = window.setInterval(report, 100);
    return () => {
      observer.disconnect();
      clearInterval(timer);
      send({ x: 0, y: 0, width: 0, height: 0, visible: false });
    };
  }, [covered, ref, send]);
}
