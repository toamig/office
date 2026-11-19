import { useState } from "react";
import { PrsPanel } from "../../components/PrsPanel";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { Button, Card, EmptyState, Input, notifyDone, notifyError } from "../../ui";
import { RecentRuns } from "./RecentRuns";

/** A project's details on the side: what waits on you, the recent agent runs, open pull requests, and a quick note. */
export function ProjectInspector({ id }: { id: string }) {
  const items = useQuery("vault.openItems", { projectId: id }, ["vault.changed"]);
  const [note, setNote] = useState("");
  const waiting = items.data?.waiting ?? [];
  const tick = async (raw: string): Promise<void> => {
    try {
      await office.invoke("vault.tickWaiting", { projectId: id, raw });
      items.reload();
    } catch (err) {
      notifyError(err, "Could not mark that done", `inspector-${id}`);
    }
  };
  const save = async (): Promise<void> => {
    try {
      const result = await office.invoke("vault.addNote", { projectId: id, text: note });
      setNote("");
      notifyDone(
        result.pushed ? "Noted and pushed" : "Noted",
        result.pushed ? undefined : "It will be pushed on the next sync.",
        "quick-note",
      );
    } catch (err) {
      notifyError(err, "Could not save the note", "quick-note");
    }
  };
  return (
    <>
      <Card title={`Waiting on you (${waiting.length})`} testId="inspector-waiting">
        {waiting.length === 0 && (
          <EmptyState title="Nothing waits on you">Items you add show up here.</EmptyState>
        )}
        {waiting.map((w) => (
          <div key={w.raw} className="ui-line" data-testid="inspector-waiting-item">
            <div className="ui-line-main">
              {w.text}
              <div className="ui-line-sub">{w.date}</div>
            </div>
            <Button size="sm" onClick={() => void tick(w.raw)}>
              Done
            </Button>
          </div>
        ))}
      </Card>
      <RecentRuns id={id} />
      <PrsPanel projectId={id} />
      <Card title="Quick note" testId="inspector-note">
        <div className="flex items-end gap-2">
          <Input
            className="flex-1"
            label="Quick note"
            hideLabel
            placeholder="What do you want to remember?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="inspector-note-text"
          />
          <Button
            variant="primary"
            disabled={!note.trim()}
            onClick={() => void save()}
            data-testid="inspector-note-save"
          >
            Save
          </Button>
        </div>
      </Card>
    </>
  );
}
