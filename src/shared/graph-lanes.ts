import type { GraphRow } from "./models";

/** The colour index of the lane that holds every branch past the cap: the muted tone. */
export const FOLD_COLOR = 5;

/**
 * A busy repo has dozens of branches running side by side, which would push the commit text out of view. Lanes past
 * `cap` are folded into one lane at index `cap`, drawn in the muted tone; the rows keep their commits and the lines
 * that matter, and the graph is never wider than `cap + 1` lanes. `hidden` is how many lanes were folded.
 */
export function foldLanes(
  rows: GraphRow[],
  width: number,
  cap: number,
): { rows: GraphRow[]; width: number; hidden: number } {
  if (width <= cap + 1) return { rows, width, hidden: 0 };
  const lane = (l: number): number => (l > cap ? cap : l);
  const color = (l: number, c: number): number => (l > cap ? FOLD_COLOR : c);
  const unique = <T extends { lane: number }>(list: T[]): T[] => {
    const seen = new Set<number>();
    return list.filter((s) => (seen.has(s.lane) ? false : (seen.add(s.lane), true)));
  };
  const folded = rows.map((r): GraphRow => {
    const toBelow = r.toBelow.map((t) => ({ to: lane(t.to), color: color(t.to, t.color) }));
    const seenTo = new Set<number>();
    return {
      ...r,
      col: lane(r.col),
      color: color(r.col, r.color),
      fromAbove: unique(
        r.fromAbove.map((f) => ({ lane: lane(f.lane), color: color(f.lane, f.color) })),
      ),
      through: unique(
        r.through.map((t) => ({ lane: lane(t.lane), color: color(t.lane, t.color) })),
      ),
      toBelow: toBelow.filter((t) => (seenTo.has(t.to) ? false : (seenTo.add(t.to), true))),
    };
  });
  return { rows: folded, width: cap + 1, hidden: width - cap - 1 };
}
