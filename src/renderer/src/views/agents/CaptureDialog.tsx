import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { CaptureResult, SessionRow } from "@shared/models";
import { Banner, Button, Dialog, Dropdown, EmptyState, Input, notifyError } from "../../ui";
import { office } from "../../lib/ipc";

type Dest = "waiting" | "todo" | "drop";
interface Row {
  text: string;
  dest: Dest;
}

/**
 * End-of-session capture: the tool is asked what is left, and each item can be edited, dropped, or
 * sent to "Waiting on you" or to the project's open items, before the session is archived.
 */
export function CaptureDialog({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
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
      (err: Error) => alive && setFailed(err.message),
    );
    return () => {
      alive = false;
    };
  }, [session.id]);

  const update = (index: number, patch: Partial<Row>): void =>
    setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const finish = async (save: boolean, archive = true): Promise<void> => {
    setSaving(true);
    try {
      await office.invoke("capture.commit", {
        id: session.id,
        items: save ? rows.filter((r) => r.text.trim()) : [],
        archive,
      });
      onClose();
    } catch (err) {
      notifyError(err, "Could not close that session", `capture-${session.id}`);
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={`Close ${session.title ?? "session"}: what is left?`}
      testId="capture-dialog"
      wide
      onClose={onClose}
      footer={
        <>
          <Button
            disabled={!result && !failed}
            onClick={() => void finish(false)}
            data-testid="capture-skip"
          >
            Archive without saving
          </Button>
          <Button
            disabled={saving || !result}
            onClick={() => void finish(true, false)}
            data-testid="capture-keep"
          >
            Save and keep open
          </Button>
          <Button
            variant="primary"
            disabled={saving || !result}
            onClick={() => void finish(true)}
            data-testid="capture-save"
          >
            {saving ? "Saving..." : "Save and archive"}
          </Button>
        </>
      }
    >
      {failed && <Banner tone="danger">{failed}</Banner>}
      {!result && !failed && (
        <EmptyState title="Reading the session">
          Closing the terminal and reading what is left in this session...
        </EmptyState>
      )}
      {result && !result.supported && (
        <p className="ui-muted mt-0">
          This tool cannot be read automatically. Type anything that is still open, or archive
          without saving.
        </p>
      )}
      {result?.error && (
        <Banner tone="attention">
          The capture run failed: {result.error}. You can still type items by hand.
        </Banner>
      )}
      {result && result.supported && !result.error && rows.length === 0 && (
        <EmptyState title="Nothing is left">
          According to the session, there is nothing left to do.
        </EmptyState>
      )}
      <div data-testid="capture-items">
        {rows.map((row, index) => (
          <div key={index} className="mb-2 flex items-end gap-2" data-testid="capture-item">
            <Input
              className="flex-1"
              label="Item text"
              hideLabel
              value={row.text}
              onChange={(e) => update(index, { text: e.target.value })}
            />
            <Dropdown
              value={row.dest}
              aria-label="Where it goes"
              onChange={(e) => update(index, { dest: e.target.value as Dest })}
            >
              <option value="waiting">Waiting on you</option>
              <option value="todo">Open items</option>
              <option value="drop">Drop</option>
            </Dropdown>
          </div>
        ))}
      </div>
      {result && (
        <Button
          onClick={() => setRows((all) => [...all, { text: "", dest: "todo" }])}
          data-testid="capture-add"
        >
          <Plus /> Add an item
        </Button>
      )}
    </Dialog>
  );
}
