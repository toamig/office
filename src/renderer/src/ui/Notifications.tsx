import { AlertTriangle, Check, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Button, IconButton } from "./Button";

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

interface NoteState {
  /** The pop-ups showing now. Nothing is kept once one leaves. */
  live: Note[];
  seq: number;
  push: (n: NoteInput) => number;
  dismiss: (id: number) => void;
}

export const useNotes = create<NoteState>((set, get) => ({
  live: [],
  seq: 0,
  push: (input) => {
    const id = get().seq + 1;
    const note: Note = { ...input, id, at: Date.now() };
    set((s) => ({
      seq: id,
      // A newer result for the same subject replaces the older one.
      live: [...s.live.filter((n) => !input.subject || n.subject !== input.subject), note],
    }));
    return id;
  },
  dismiss: (id) => set((s) => ({ live: s.live.filter((n) => n.id !== id) })),
}));

/** The cause of an error in plain words: the transport's wrapping ("Error invoking remote method ...") is dropped. */
export function plainCause(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw
      .replace(/^Error invoking remote method '[^']*':\s*/, "")
      .replace(/^(\w*Error|IpcFailure):\s*/, "")
      .trim() || "Something went wrong."
  );
}

/**
 * An error from an action, as a notification that stays until it is closed or replaced by a newer result for the same
 * subject. It names the action that failed (the title), says why in plain words, and offers one next step.
 */
export function notifyError(
  err: unknown,
  title: string,
  subject?: string,
  action?: { label: string; run: () => void },
): number {
  return notify({ tone: "danger", title, detail: plainCause(err), subject, action });
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
