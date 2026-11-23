import { useMemo, useState } from "react";
import {
  DAY_NAMES, choiceFromSchedule, describeNext, describeSchedule, nextRuns, scheduleFromChoice, validCron,
  type ScheduleChoice,
} from "@shared/schedule";
import { Button, Dropdown, Input } from "../../ui";

const KINDS: Array<{ kind: ScheduleChoice["kind"]; label: string }> = [
  { kind: "manual", label: "On demand" },
  { kind: "daily", label: "Every day at a time" },
  { kind: "weekdays", label: "Weekdays at a time" },
  { kind: "days", label: "On chosen days at a time" },
  { kind: "hours", label: "Every few hours" },
  { kind: "custom", label: "Custom (cron)" },
];

function startChoice(kind: ScheduleChoice["kind"], from: ScheduleChoice): ScheduleChoice {
  const time = "time" in from ? from.time : "08:00";
  switch (kind) {
    case "manual": return { kind };
    case "daily": return { kind, time };
    case "weekdays": return { kind, time };
    case "days": return { kind, days: "days" in from ? from.days : [1], time };
    case "hours": return { kind, every: "every" in from ? from.every : 6 };
    case "custom": return { kind, cron: scheduleFromChoice(from) ?? "0 8 * * 1" };
  }
}

const dayLetters = [1, 2, 3, 4, 5, 6, 0];

/** The schedule in plain words: a picker for each kind, the reading of what it means, and the next three runs. */
export function SchedulePicker({ value, onChange }: { value: string | null; onChange: (schedule: string | null) => void }) {
  const parsed = useMemo(() => choiceFromSchedule(value), [value]);
  // Custom stays custom while it is typed, even when the text happens to match a plain schedule.
  const [custom, setCustom] = useState(parsed.kind === "custom");
  const choice: ScheduleChoice = custom ? { kind: "custom", cron: value ?? "" } : parsed;
  const set = (next: ScheduleChoice): void => onChange(scheduleFromChoice(next));
  const bad = choice.kind === "custom" && (!choice.cron || !validCron(choice.cron));
  const upcoming = useMemo(() => bad ? [] : nextRuns(value, 3, new Date()), [value, bad]);
  return (
    <div className="grid gap-2">
      <label className="grid gap-1">
        <span className="ui-label">Schedule</span>
        <Dropdown aria-label="Schedule" value={choice.kind} onChange={(event) => {
          const kind = KINDS.find((entry) => entry.kind === event.target.value)?.kind ?? "manual";
          setCustom(kind === "custom");
          if (kind === "custom") onChange(scheduleFromChoice(startChoice(kind, choice)) ?? "");
          else set(startChoice(kind, choice));
        }}>
          {KINDS.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}
        </Dropdown>
      </label>
      {"time" in choice && <Input label="Time" type="time" value={choice.time} className="max-w-40"
        onChange={(event) => { if (event.target.value) set({ ...choice, time: event.target.value }); }} />}
      {choice.kind === "days" && <div className="grid gap-1">
        <span className="ui-label">Days</span>
        <div role="group" aria-label="Days" className="flex flex-wrap gap-1">
          {dayLetters.map((day) => {
            const on = choice.days.includes(day);
            return <Button key={day} size="sm" variant={on ? "primary" : "secondary"} aria-pressed={on} title={DAY_NAMES[day]}
              onClick={() => {
                const days = on ? choice.days.filter((entry) => entry !== day) : [...choice.days, day];
                if (days.length > 0) set({ ...choice, days });
              }}>{DAY_NAMES[day]?.slice(0, 3)}</Button>;
          })}
        </div>
      </div>}
      {choice.kind === "hours" && <Input label="Every how many hours" type="number" min={1} max={23} className="max-w-40"
        value={choice.every} onChange={(event) => set({ kind: "hours", every: Number(event.target.value) || 1 })} />}
      {choice.kind === "custom" && <Input label="Schedule (cron)" value={choice.cron} className="font-mono"
        error={bad ? "Not a valid schedule" : null} onChange={(event) => onChange(event.target.value)} />}
      {choice.kind !== "manual" && !bad && <p className="ui-muted" aria-live="polite">
        {describeSchedule(value)}
        {upcoming.length > 0 && <> {"·"} Next: {upcoming.map((at) => describeNext(at, new Date())).join(", ")}</>}
      </p>}
    </div>
  );
}
