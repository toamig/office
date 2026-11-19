import { AlertTriangle, Bell, Check, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Button, IconButton } from "./Button";
import { CountPill } from "./Status";

export type NoteTone = "success" | "info" | "attention" | "danger";

export interface Note {
  id: number;
  /** A notification for the same subject replaces the earlier one instead of piling up. */
  subject?: string | undefined;
  tone: NoteTone;
  title: string;
  detail?: string | undefined;
  /** At most one action: Open, Retry, Undo, Show log. */
  action?: { label: string; run: () => void } | undefined;
  at: number;
}

export type NoteInput = Omit<Note, "id" | "at">;

const SHOWN = 4;
const HISTORY = 50;

interface NoteState {
  live: Note[];
  history: Note[];
  seq: number;
  push: (n: NoteInput) => number;
  dismiss: (id: number) => void;
}

export const useNotes = create<NoteState>((set, get) => ({
  live: [],
  history: [],
  seq: 0,
  push: (input) => {
    const id = get().seq + 1;
    const note: Note = { ...input, id, at: Date.now() };
    set((s) => ({
      seq: id,
      // A newer result for the same subject replaces the older one.
      live: [...s.live.filter((n) => !input.subject || n.subject !== input.subject), note],
      history: [note, ...s.history].slice(0, HISTORY),
    }));
    return id;
  },
  dismiss: (id) => set((s) => ({ live: s.live.filter((n) => n.id !== id) })),
}));

/** An error from an action, as a notification that stays until it is closed or replaced by a newer result for the same subject. */
export function notifyError(err: unknown, title = "That did not work", subject?: string): number {
  const message = err instanceof Error ? err.message : String(err);
  return notify({ tone: "danger", title, detail: message, subject });
}

/** A good result: a short notification that leaves by itself. */
export function notifyDone(title: string, detail?: string, subject?: string): number {
  return notify({ tone: "success", title, detail, subject });
}

/** Shows the result of an action. Callable from anywhere, not only from components. */
export function notify(input: NoteInput): number {
  return useNotes.getState().push(input);
}

/** How long a notification stays: success and info 4 s, warnings 8 s, errors until closed. */
export const lifetimeOf = (tone: NoteTone): number | null =>
  tone === "danger" ? null : tone === "attention" ? 8000 : 4000;

const ICON: Record<NoteTone, typeof Check> = {
  success: Check,
  info: Info,
  attention: AlertTriangle,
  danger: AlertTriangle,
};

function Toast({ note }: { note: Note }) {
  const dismiss = useNotes((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const left = useRef(lifetimeOf(note.tone));
  const started = useRef(0);
  useEffect(() => {
    if (paused || left.current === null) return;
    started.current = Date.now();
    const timer = setTimeout(() => dismiss(note.id), left.current);
    return () => {
      clearTimeout(timer);
      if (left.current !== null) left.current -= Date.now() - started.current;
    };
  }, [paused, note.id, dismiss]);
  const Icon = ICON[note.tone];
  return (
    <div
      className="ui-toast"
      data-tone={note.tone}
      data-testid="notification-toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Icon size={16} style={{ color: "var(--tone)" }} aria-hidden />
      <div className="min-w-0">
        <div className="ui-toast-title">{note.title}</div>
        {note.detail && <div className="ui-toast-detail">{note.detail}</div>}
        {note.action && (
          <Button
            size="sm"
            className="mt-2"
            onClick={() => {
              note.action?.run();
              dismiss(note.id);
            }}
          >
            {note.action.label}
          </Button>
        )}
      </div>
      <IconButton label="Close notification" size="sm" onClick={() => dismiss(note.id)}>
        <X size={14} />
      </IconButton>
    </div>
  );
}

/** The stack in the bottom-right corner: newest at the bottom, four at most, the rest folded. Never takes focus. */
export function NotificationStack() {
  const live = useNotes((s) => s.live);
  const shown = live.slice(-SHOWN);
  const folded = live.length - shown.length;
  return (
    <div
      className="ui-toasts"
      aria-live="polite"
      aria-atomic="false"
      data-testid="notification-stack"
    >
      {folded > 0 && (
        <div className="ui-toast-detail" style={{ pointerEvents: "auto", textAlign: "right" }}>
          {folded} more
        </div>
      )}
      {shown.map((n) => (
        <Toast key={n.id} note={n} />
      ))}
    </div>
  );
}

/** The bell in the top bar: the last 50 notifications of this session. */
export function NotificationBell() {
  const history = useNotes((s) => s.history);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton label="Notifications" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Bell size={16} />
        {history.length > 0 && <CountPill count={history.length} tone="muted" />}
      </IconButton>
      {open && (
        <div className="ui-popover" data-testid="notification-history">
          {history.length === 0 && (
            <p className="m-3 text-[length:var(--text-sm)]">Nothing yet this session.</p>
          )}
          {history.map((n) => (
            <div key={n.id} className="ui-row" data-testid="notification-history-row">
              <div className="min-w-0 flex-1">
                <div className="ui-toast-title">{n.title}</div>
                {n.detail && <div className="ui-toast-detail">{n.detail}</div>}
              </div>
              <span className="ui-toast-detail num">
                {new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
