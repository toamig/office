import { z } from "zod";
import { describeSchedule } from "./schedule";

/** Where a cloud routine's finished runs are delivered. */
export const CloudSendTo = z.enum(["worth-a-look", "pending", "note", "nothing"]);
export type CloudSendTo = z.infer<typeof CloudSendTo>;
export const cloudSendToLabels: Record<CloudSendTo, string> = {
  "worth-a-look": "Worth a look", pending: "Needs you", note: "Brain note", nothing: "Nothing",
};

/** A cloud routine's saved choice, kept in the workspace config with the routine's id. */
export const CloudRoutineSetting = z.object({ id: z.string().regex(/^trig_[A-Za-z0-9_-]+$/), sendTo: CloudSendTo });
export type CloudRoutineSetting = z.infer<typeof CloudRoutineSetting>;

export const CloudRunView = z.object({
  /** How the run ended: succeeded, failed, or still going. */
  state: z.enum(["succeeded", "failed", "running"]),
  firedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Whole seconds, when both times are known. */
  seconds: z.number().nullable(),
  /** Why it failed, as the routine reported it. Third-party text. */
  failure: z.string().nullable(),
  /** The run's own page in Claude, when known. */
  url: z.string().nullable(),
});
export type CloudRunView = z.infer<typeof CloudRunView>;

export const CloudRoutineView = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  /** A run-once routine that already fired, or one that ended. */
  finished: z.boolean(),
  /** The schedule in words and local time; null for a run-once routine. */
  schedule: z.string().nullable(),
  /** The next run, as a time. */
  nextRun: z.string().nullable(),
  lastRun: CloudRunView.nullable(),
  /** The page to open in Claude: the last run's, else the routines page. */
  link: z.string(),
  sendTo: CloudSendTo,
  /** The Office project one of the routine's repositories belongs to. */
  projectName: z.string().nullable(),
  details: z.object({
    model: z.string().nullable(),
    prompt: z.string().nullable(),
    repositories: z.array(z.string()),
    connectors: z.array(z.string()),
    /** The routine's own schedule string (UTC). */
    cron: z.string().nullable(),
    id: z.string(),
  }),
});
export type CloudRoutineView = z.infer<typeof CloudRoutineView>;

export const CloudState = z.object({
  status: z.enum(["loading", "ok", "unavailable"]),
  /** One line in words when the routines cannot be read. */
  message: z.string().nullable(),
  /** The reason in detail, shown under Details. */
  reason: z.string().nullable(),
  refreshedAt: z.string().nullable(),
  refreshing: z.boolean(),
  routines: z.array(CloudRoutineView),
});
export type CloudState = z.infer<typeof CloudState>;

export const CLOUD_ROUTINES_PAGE = "https://claude.ai/code/routines";

const field = (value: string | undefined): number | null => (value !== undefined && /^\d{1,2}$/.test(value) ? Number(value) : null);

/** The days a cron weekday field names (numbers, lists and ranges only). */
function weekdays(value: string): number[] | null {
  if (value === "*") return [];
  const days: number[] = [];
  for (const part of value.split(",")) {
    const range = /^([0-7])-([0-7])$/.exec(part);
    if (range) for (let day = Number(range[1]); day <= Number(range[2]); day += 1) days.push(day % 7);
    else if (/^[0-7]$/.test(part)) days.push(Number(part) % 7);
    else return null;
  }
  return [...new Set(days)];
}

/**
 * A routine's schedule is UTC. This turns a plain daily or weekly one ("30 7 * * 1") into the same moment in the
 * local zone, so describeSchedule can say it in local time. Anything else comes back unchanged and is read as it is.
 */
export function utcCronToLocal(cron: string, at: Date = new Date()): string {
  const fields = cron.trim().split(/\s+/);
  const [minuteField, hourField, dayOfMonth, month, weekday] = fields;
  const minute = field(minuteField);
  const hour = field(hourField);
  if (fields.length !== 5 || minute === null || hour === null || dayOfMonth !== "*" || month !== "*" || weekday === undefined) return cron;
  const days = weekdays(weekday);
  if (days === null) return cron;
  // The zone's offset on the next day this runs, so the summer-time shift is the one that applies then.
  const base = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), hour, minute));
  const offset = -base.getTimezoneOffset();
  const total = hour * 60 + minute + offset;
  const shift = Math.floor(total / 1440);
  const local = ((total % 1440) + 1440) % 1440;
  const days2 = days.map((day) => (((day + shift) % 7) + 7) % 7).sort((a, b) => a - b);
  return `${local % 60} ${Math.floor(local / 60)} * * ${weekday === "*" ? "*" : days2.join(",")}`;
}

/** A routine's schedule in words, in local time: "Every Monday at 09:30". */
export function describeCloudSchedule(cron: string | null, at: Date = new Date()): string | null {
  if (!cron || !cron.trim()) return null;
  return describeSchedule(utcCronToLocal(cron, at));
}
