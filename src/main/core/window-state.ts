export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  maximized?: boolean | undefined;
}

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;
/** How much of the window must be on a screen for it to be reachable (width and height, in pixels). */
const VISIBLE = 120;

const overlap = (a: Bounds, b: Bounds): { w: number; h: number } => ({
  w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

/**
 * Where the window opens: where it was left, if enough of it is on a screen that still exists, otherwise
 * centred on the primary screen at its default size. `displays` are the work areas of every screen.
 */
export function restoreBounds(
  saved: SavedWindow | undefined,
  displays: Bounds[],
  primary: Bounds,
  fallback = { width: 1280, height: 800 },
): { bounds: Bounds; maximized: boolean } {
  const fit = (): Bounds => {
    const width = Math.min(fallback.width, primary.width);
    const height = Math.min(fallback.height, primary.height);
    return {
      width,
      height,
      x: primary.x + Math.round((primary.width - width) / 2),
      y: primary.y + Math.round((primary.height - height) / 2),
    };
  };
  if (!saved) return { bounds: fit(), maximized: false };
  const bounds: Bounds = {
    x: saved.x,
    y: saved.y,
    width: Math.max(MIN_WIDTH, saved.w),
    height: Math.max(MIN_HEIGHT, saved.h),
  };
  const reachable = displays.some((d) => {
    const o = overlap(bounds, d);
    return o.w >= VISIBLE && o.h >= VISIBLE;
  });
  return reachable
    ? { bounds, maximized: saved.maximized === true }
    : { bounds: fit(), maximized: saved.maximized === true };
}

/** The settings entry for a window's current state (its normal bounds, even while maximised). */
export function toSaved(normal: Bounds, maximized: boolean): SavedWindow {
  return { x: normal.x, y: normal.y, w: normal.width, h: normal.height, maximized };
}
