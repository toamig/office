import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CaptureResult, SessionRow } from "@shared/models";
import { Button, EmptyState, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";

type Dest = "waiting" | "todo" | "drop";
interface Row {
  text: string;
  dest: Dest;
}

const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };

/**
 * End-of-session capture: the tool is asked what is left, and each item can be edited, dropped, or
 * sent to "Waiting on you" or to the project's open items, before the session is archived.
 */
export function CaptureDialog({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    office.invoke("capture.run", { id: session.id }).then(
      (r) => {
        if (!alive) return;
        setResult(r);
        setRows(
          r.items.length > 0
            ? r.items.map((i) => ({ text: i.text, dest: i.kind }))
            : r.supported
              ? []
              : [{ text: "", dest: "todo" }],
        );
      },
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
    };
  }, [session.id]);

  const update = (index: number, patch: Partial<Row>): void =>
    setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const finish = async (save: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await office.invoke("capture.commit", {
        id: session.id,
        items: save ? rows.filter((r) => r.text.trim()) : [],
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      data-testid="capture-dialog"
    >
      <div
        className="flex max-h-[85vh] w-[680px] flex-col rounded border"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <h2 className="m-0 text-sm font-semibold">
            Close {session.title ?? "session"}: what is left?
          </h2>
          <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>
            <X size={14} />
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-4">
          {error && <ErrorBanner message={error} />}
          {!result && !error && (
            <EmptyState>
              Closing the terminal and reading what is left in this session...
            </EmptyState>
          )}
          {result && !result.supported && (
            <p className="mt-0" style={{ color: "var(--muted)" }}>
              This tool cannot be read automatically. Type anything that is still open, or archive
              without saving.
            </p>
          )}
          {result?.error && (
            <ErrorBanner
              message={`The capture run failed: ${result.error}. You can still type items by hand.`}
            />
          )}
          {result && result.supported && !result.error && rows.length === 0 && (
            <EmptyState>Nothing is left, according to the session.</EmptyState>
          )}
          <div data-testid="capture-items">
            {rows.map((row, index) => (
              <div key={index} className="mb-2 flex items-center gap-2" data-testid="capture-item">
                <input
                  className={`${field} flex-1`}
                  style={fieldStyle}
                  value={row.text}
                  aria-label="Item text"
                  onChange={(e) => update(index, { text: e.target.value })}
                />
                <select
                  className={field}
                  style={fieldStyle}
                  value={row.dest}
                  aria-label="Where it goes"
                  onChange={(e) => update(index, { dest: e.target.value as Dest })}
                >
                  <option value="waiting">Waiting on you</option>
                  <option value="todo">Open items</option>
                  <option value="drop">Drop</option>
                </select>
              </div>
            ))}
          </div>
          {result && (
            <Button
              onClick={() => setRows((all) => [...all, { text: "", dest: "todo" }])}
              data-testid="capture-add"
            >
              <Plus size={13} /> Add an item
            </Button>
          )}
        </div>
        <footer
          className="flex justify-end gap-2 border-t px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <Button
            disabled={!result && !error}
            onClick={() => void finish(false)}
            data-testid="capture-skip"
          >
            Archive without saving
          </Button>
          <Button
            variant="primary"
            disabled={saving || !result}
            onClick={() => void finish(true)}
            data-testid="capture-save"
          >
            {saving ? "Saving..." : "Save and archive"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
