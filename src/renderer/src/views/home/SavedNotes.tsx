import { useState } from "react";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { Button, Group, notifyError } from "../../ui";

export function SavedNotes() {
  const notes = useQuery("recorder.digest", undefined, ["recorder.changed", "brief.changed"]);
  const [busy, setBusy] = useState<string | null>(null);
  const undo = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      await office.invoke("recorder.undo", { id });
      notes.reload();
    } catch (error) {
      notifyError(error, "Could not undo the note save", "recorder");
    } finally {
      setBusy(null);
    }
  };
  if (!notes.data?.length) return null;
  return (
    <section className="mt-3">
      <Group>Saved to Brain</Group>
      {notes.data.map((note) => (
        <div key={note.id} className="ui-line">
          <div className="ui-line-main">
            <div>{note.path}</div>
            <div className="ui-line-sub">{note.summary}</div>
          </div>
          <Button size="sm" disabled={busy !== null} onClick={() => void undo(note.id)}>Undo</Button>
        </div>
      ))}
    </section>
  );
}
