import { Cron } from "croner";

/** What the schedule picker offers, in plain words. A saved schedule is still a five-field cron string. */
export type ScheduleChoice =
  | { kind: "manual" }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "days"; days: number[]; time: string }
  | { kind: "hours"; every: number }
  | { kind: "custom"; cron: string };

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function validCron(pattern: string): boolean {
  try {
    new Cron(pattern, { paused: true });
    return true;
  } catch {
    return false;
  }
}

/** The next runs of a schedule after a moment, in local time. */
export function nextRuns(pattern: string | null, count: number, from: Date): Date[] {
  if (!pattern) return [];
  try {
    return new Cron(pattern, { paused: true }).nextRuns(count, from);
  } catch {
    return [];
  }
}

const pad = (value: number | string): string => String(value).padStart(2, "0");
const parseTime = (time: string): { hour: number; minute: number } => {
  const [hour = "8", minute = "0"] = time.split(":");
  return { hour: Math.min(23, Math.max(0, Number(hour) || 0)), minute: Math.min(59, Math.max(0, Number(minute) || 0)) };
};

export function scheduleFromChoice(choice: ScheduleChoice): string | null {
  switch (choice.kind) {
    case "manual": return null;
    case "custom": return choice.cron.trim();
    case "hours": return `0 */${Math.min(23, Math.max(1, Math.round(choice.every)))} * * *`;
    default: {
      const { hour, minute } = parseTime(choice.time);
      const day = choice.kind === "daily" ? "*" : choice.kind === "weekdays" ? "1-5"
        : [...new Set(choice.days)].filter((entry) => entry >= 0 && entry <= 6).sort((a, b) => a - b).join(",") || "1";
      return `${minute} ${hour} * * ${day}`;
    }
  }
}

function dayList(field: string): number[] | undefined {
  const days: number[] = [];
  for (const part of field.split(",")) {
    const range = /^([0-7])-([0-7])$/.exec(part);
    if (range) {
      for (let day = Number(range[1]); day <= Number(range[2]); day += 1) days.push(day % 7);
    } else if (/^[0-7]$/.test(part)) days.push(Number(part) % 7);
    else return undefined;
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Reads a saved cron string back into a picker choice; anything unusual stays custom. */
export function choiceFromSchedule(schedule: string | null): ScheduleChoice {
  if (!schedule) return { kind: "manual" };
  const fields = schedule.trim().split(/\s+/);
  const [minute, hour, dayOfMonth, month, weekday] = fields;
  if (fields.length !== 5 || !minute || !hour || !weekday) return { kind: "custom", cron: schedule };
  const hours = /^0 \*\/(\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (hours) return { kind: "hours", every: Number(hours[1]) };
  if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && dayOfMonth === "*" && month === "*") {
    const time = `${pad(hour)}:${pad(minute)}`;
    if (weekday === "*") return { kind: "daily", time };
    const days = dayList(weekday);
    if (days && days.join(",") === "1,2,3,4,5") return { kind: "weekdays", time };
    if (days && days.length > 0 && days.length < 7) return { kind: "days", days, time };
  }
  return { kind: "custom", cron: schedule };
}

function joinDays(days: number[]): string {
  const names = days.map((day) => DAY_NAMES[day] ?? "");
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A schedule in words: "Every Monday at 09:00", "Weekdays at 08:00", "Every 6 hours". */
export function describeSchedule(schedule: string | null): string {
  if (!schedule) return "On demand";
  const choice = choiceFromSchedule(schedule);
  switch (choice.kind) {
    case "manual": return "On demand";
    case "daily": return `Every day at ${choice.time}`;
    case "weekdays": return `Weekdays at ${choice.time}`;
    case "days": return `Every ${joinDays(choice.days)} at ${choice.time}`;
    case "hours": return choice.every === 1 ? "Every hour" : `Every ${choice.every} hours`;
    case "custom": break;
  }
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return "Custom schedule";
  const [minute, hour, day, month, weekday] = fields;
  if (schedule.trim() === "* * * * *") return "Every minute";
  if (minute && /^\*\/\d+$/.test(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*")
    return `Every ${minute.slice(2)} minutes`;
  if (minute && /^\d{1,2}$/.test(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*")
    return Number(minute) === 0 ? "Every hour" : `At minute ${Number(minute)} of every hour`;
  if (minute && hour && /^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && month === "*" && day && /^\d{1,2}$/.test(day) && weekday === "*")
    return `Day ${day} of each month at ${pad(hour)}:${pad(minute)}`;
  return "Custom schedule";
}

/** "Monday 09:00", "today 14:00", "tomorrow 08:00": a coming run, relative to now. */
export function describeNext(at: Date, now: Date): string {
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const gap = Math.round((day(at) - day(now)) / 86_400_000);
  if (gap <= 0) return `today ${time}`;
  if (gap === 1) return `tomorrow ${time}`;
  if (gap < 7) return `${DAY_NAMES[at.getDay()]} ${time}`;
  return `${DAY_NAMES[at.getDay()]?.slice(0, 3)} ${at.getDate()} ${at.toLocaleString("en", { month: "short" })} ${time}`;
}
