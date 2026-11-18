import { GitBranch, MessageSquare, Square } from "lucide-react";
import type { SessionRow } from "@shared/models";
import { office } from "../../lib/ipc";
import { Select } from "../../components/Select";
import { StatusChip } from "../../components/StatusChip";

/**
 * The strip above a session's terminal: its name (a picker when panes are split), status, branch and a Stop
 * button, so a terminal reads as part of the app and not as a console patched in.
 */
export function PaneHeader({
  session,
  options,
  split,
  onPick,
  onChanged,
}: {
  session: SessionRow | undefined;
  options: Array<{ id: string; title: string }>;
  split: boolean;
  onPick: (id: string) => void;
  onChanged: () => void;
}) {
  if (!session) return null;
  return (
    <div className="pane-header" data-testid="pane-header">
      {split ? (
        <Select
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
        </Select>
      ) : (
        <span className="pane-title">{session.title ?? session.provider}</span>
      )}
      <StatusChip status={session.status} />
      {session.branch && (
        <span className="pane-branch">
          <GitBranch size={12} />
          {session.branch}
        </span>
      )}
      <div className="flex-1" />
      {session.provider !== "terminal" && session.mode === "terminal" && (
        <button
          className="chat-link"
          onClick={() => void office.invoke("chat.toChat", { id: session.id }).then(onChanged)}
          data-testid="back-to-chat"
        >
          <MessageSquare size={13} /> Back to chat
        </button>
      )}
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
