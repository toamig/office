import { GitBranch, Square } from "lucide-react";
import type { SessionRow } from "@shared/models";
import { Chip } from "../../components/ui";
import { office } from "../../lib/ipc";

const tone = (s: SessionRow["status"]): "neutral" | "good" | "warn" | "bad" =>
  s === "needs-you" || s === "failed" ? "bad" : s === "working" ? "good" : "neutral";

/**
 * The strip above a session's terminal: its name (a picker when panes are split), status, branch and a Stop
 * button, so a terminal reads as part of the app and not as a console patched in.
 */
export function PaneHeader({
  session,
  options,
  split,
  onPick,
}: {
  session: SessionRow | undefined;
  options: Array<{ id: string; title: string }>;
  split: boolean;
  onPick: (id: string) => void;
}) {
  if (!session) return null;
  return (
    <div className="pane-header" data-testid="pane-header">
      {split ? (
        <select
          value={session.id}
          onChange={(e) => onPick(e.target.value)}
          aria-label="Pane session"
          className="pane-select"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      ) : (
        <span className="pane-title">{session.title ?? session.provider}</span>
      )}
      <Chip tone={tone(session.status)}>{session.status}</Chip>
      {session.branch && (
        <span className="pane-branch">
          <GitBranch size={12} />
          {session.branch}
        </span>
      )}
      <div className="flex-1" />
      {session.running && (
        <button
          className="bar-button"
          aria-label="Stop"
          title="Stop this session"
          onClick={() => void office.invoke("sessions.kill", { id: session.id })}
          data-testid="pane-stop"
        >
          <Square size={13} />
        </button>
      )}
    </div>
  );
}
