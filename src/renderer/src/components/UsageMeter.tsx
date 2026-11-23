import type { LimitWindow } from "@shared/usage";
import { useQuery } from "../lib/hooks";
import { useUi } from "../stores/ui";

export const formatTokens = (tokens: number): string =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M tokens` : tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 100_000 ? 0 : 1)}k tokens` : `${tokens} tokens`;

export const formatCost = (usd: number): string => (usd > 0 && usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`);

const reset = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "resets soon";
  if (minutes < 90) return `resets in ${minutes} min`;
  if (minutes < 36 * 60) return `resets in ${Math.round(minutes / 60)} h`;
  return `resets ${date.toLocaleDateString(undefined, { weekday: "long" })}`;
};

const tone = (window: LimitWindow): "ok" | "warn" | "bad" => (window.utilization >= 0.95 ? "bad" : window.utilization >= 0.8 ? "warn" : "ok");

/** One bar for each plan window the program reported, with how full it is and when it resets. */
export function LimitBars({ windows, updatedAt }: { windows: LimitWindow[]; updatedAt: string | null }) {
  return (
    <div className="grid gap-2">
      {windows.map((window) => (
        <div key={window.key} className="grid gap-1">
          <div className="flex justify-between gap-2">
            <span>{window.label}</span>
            <span className="ui-muted tabular-nums">{Math.round(window.utilization * 100)}% used{window.resetsAt ? `, ${reset(window.resetsAt)}` : ""}</span>
          </div>
          <div className="usage-limit" data-tone={tone(window)} role="meter" aria-label={window.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(window.utilization * 100)}>
            <span style={{ width: `${Math.min(100, Math.round(window.utilization * 100))}%` }} />
          </div>
        </div>
      ))}
      {updatedAt && <span className="ui-muted">Last reported {new Date(updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.</span>}
    </div>
  );
}

/** The top bar's meter: the five-hour and weekly use of the Claude plan, when Claude Code reports them. It opens Usage. */
export function UsageMeter() {
  const limits = useQuery("usage.limits", undefined, ["usage.changed"]);
  const navigate = useUi((state) => state.navigate);
  const windows = limits.data?.claudeCode;
  if (!windows?.length) return null;
  const short = (window: LimitWindow): string => `${window.key === "five_hour" ? "5h" : window.key === "seven_day" ? "Week" : window.label} ${Math.round(window.utilization * 100)}%`;
  const shown = windows.filter((window) => window.key === "five_hour" || window.key === "seven_day");
  return (
    <button type="button" className="bar-button usage-meter" onClick={() => navigate("usage")} data-testid="usage-meter"
      title={windows.map((window) => `${window.label}: ${Math.round(window.utilization * 100)}% used ${reset(window.resetsAt)}`).join("\n")}
      aria-label={`Plan use: ${shown.map(short).join(", ")}. Open Usage.`}>
      {shown.map((window) => <span key={window.key} data-tone={tone(window)}>{short(window)}</span>)}
    </button>
  );
}
