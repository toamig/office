import { z } from "zod";

/*
 * The brief: where you left off. It covers the time since you last worked, one card per project with what was done,
 * where it stands and what to do next, and every line leads to the exact session, commit or note it came from.
 */

export const BriefRange = z.enum(["since-last", "three-days", "this-week"]);
export type BriefRange = z.infer<typeof BriefRange>;
export const BRIEF_RANGE_LABELS: Record<BriefRange, string> = {
  "since-last": "Since last time", "three-days": "Last 3 days", "this-week": "This week",
};

export const BriefLink = z.object({ view: z.string(), params: z.record(z.string(), z.string()).optional() });
export type BriefLink = z.infer<typeof BriefLink>;

/** One line of a card, with the exact place it came from. */
export const BriefLine = z.object({ text: z.string(), link: BriefLink });
export type BriefLine = z.infer<typeof BriefLine>;

/** A next step with the button that does it. */
export const BriefNext = z.object({
  text: z.string(),
  action: z.discriminatedUnion("kind", [
    /** Opens the session where it left off. */
    z.object({ kind: z.literal("continue"), sessionId: z.string() }),
    /** Starts a session with this as its brief. */
    z.object({ kind: z.literal("start"), projectId: z.string(), brief: z.string() }),
    /** Opens a note or plan. */
    z.object({ kind: z.literal("open"), link: BriefLink }),
  ]),
});
export type BriefNext = z.infer<typeof BriefNext>;

export const BriefCard = z.object({
  projectId: z.string(),
  projectName: z.string(),
  done: z.array(BriefLine),
  stands: z.array(BriefLine),
  next: z.array(BriefNext),
  /** What the brief does not know, when the facts were thin. */
  unknown: z.string().nullable(),
});
export type BriefCard = z.infer<typeof BriefCard>;

export const BriefView = z.object({
  /** Local date (YYYY-MM-DD) of the newest brief, or null when none was written yet. */
  date: z.string().nullable(),
  range: BriefRange,
  /** Where the covered time starts. */
  since: z.string().nullable(),
  cards: z.array(BriefCard),
  /** At most three things that need you today, across projects. */
  needsYou: z.array(BriefLine),
});
export type BriefView = z.infer<typeof BriefView>;

const pad = (n: number): string => String(n).padStart(2, "0");
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Where a brief starts. Since last time is the start of the latest day before today on which you worked (a session,
 * a chat or a commit), so a Monday covers Friday and a week away covers the week; with no such day, yesterday.
 */
export function briefSince(range: BriefRange, now: Date, activeDays: Iterable<string>): Date {
  const today = midnight(now);
  if (range === "three-days") return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
  if (range === "this-week") return new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const before = [...activeDays].filter((day) => day < localDate(now)).sort().at(-1);
  if (!before) return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const [y, m, d] = before.split("-").map(Number);
  return new Date(y ?? today.getFullYear(), (m ?? 1) - 1, d ?? 1);
}

/** Phrases that say nothing: a line made of them is not allowed. */
export const EMPTY_PHRASES = /\b(made progress|various updates|worked on|some updates|several changes|general improvements|continued work)\b/i;

/** What a model's line must have: a few words, a concrete subject, none of the empty phrases. */
export const concreteLine = (text: string): boolean => text.trim().split(/\s+/).length >= 3 && !EMPTY_PHRASES.test(text);
