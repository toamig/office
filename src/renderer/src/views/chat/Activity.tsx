import { useEffect, useState, type ReactNode } from "react";
import { activityLabel, formatElapsed, runningLabel, toolGroup, type ChatItem, type TurnActivity } from "@shared/chat";

type Tool = Extract<ChatItem, { kind: "tool" }>;

export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="num">{formatElapsed(now - since)}</span>;
}

export function LivePlan({ steps }: { steps: TurnActivity["plan"] }) {
  if (!steps.length) return null;
  const done = steps.filter((step) => step.status === "completed").length;
  return <details className="tool-card" data-testid="live-plan">
    <summary className="cursor-pointer px-2 py-1">Plan: {done} of {steps.length}</summary>
    <ul className="todo-list max-h-40 overflow-auto">
      {steps.map((step, index) => {
        const status = step.status === "completed" ? "Done" : step.status === "in_progress" ? "Working" : "Not started";
        return <li key={index} data-status={step.status}>
          <span className="todo-box" role="img" aria-label={status} title={status}>
            {step.status === "completed" ? "✓" : step.status === "in_progress" ? "●" : "○"}
          </span>
          {step.text}
        </li>;
      })}
    </ul>
  </details>;
}

export function TurnStatus({ activity }: { activity: TurnActivity }) {
  if (activity.startedAt === undefined && activity.durationMs === undefined) return null;
  return <div className="turn-footer truncate" data-testid="turn-status" title={activityLabel(activity)}>
    {activity.startedAt === undefined
      ? `Worked ${formatElapsed(activity.durationMs ?? 0)}`
      : <>{activityLabel(activity)}, <Elapsed since={activity.startedAt} /></>}
  </div>;
}

export function ToolGroup({ tools, children }: { tools: Tool[]; children: ReactNode }) {
  if (tools.length === 1) return children;
  const counts = { read: 0, search: 0, command: 0 };
  for (const tool of tools) {
    const group = toolGroup(tool.name);
    if (group) counts[group]++;
  }
  const label = [
    counts.read && `Read ${counts.read} ${counts.read === 1 ? "file" : "files"}`,
    counts.search && `Ran ${counts.search} ${counts.search === 1 ? "search" : "searches"}`,
    counts.command && `Ran ${counts.command} ${counts.command === 1 ? "command" : "commands"}`,
  ].filter(Boolean).join(", ").replace(/, Ran/g, ", ran");
  const latest = tools.findLast((tool) => tool.status === "running");
  return <details className="tool-card" data-testid="tool-group">
    <summary className="cursor-pointer truncate px-2 py-1">
      {label}
      {latest && <span className="ui-muted"> · {runningLabel(latest)}{latest.startedAt !== undefined && <>, <Elapsed since={latest.startedAt} /></>}</span>}
    </summary>
    <div className="tool-body">{children}</div>
  </details>;
}
