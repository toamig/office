import { z } from "zod";

/** What a session did and where it left off, written by the recorder when the session wraps up or goes idle. */
export const Recap = z.object({
  /** What the owner asked for, in a sentence. */
  asked: z.string().trim().min(1).max(400),
  /** What was done, naming files, commits and decisions (by ADR number). */
  done: z.array(z.string().trim().min(1).max(300)).max(8),
  /** What was left unfinished. */
  unfinished: z.array(z.string().trim().min(1).max(300)).max(6),
  /** The next concrete step, or null when nothing is left. */
  next: z.string().trim().min(1).max(300).nullable(),
});
export type Recap = z.infer<typeof Recap>;

export const SessionRecap = Recap.extend({ sessionId: z.string(), at: z.string() });
export type SessionRecap = z.infer<typeof SessionRecap>;

/** The one line the Sessions list shows for a session. */
export const recapLine = (recap: Pick<Recap, "asked" | "next">): string =>
  recap.next ? `Next: ${recap.next}` : recap.asked;
