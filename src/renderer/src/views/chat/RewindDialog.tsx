import { useEffect, useState } from "react";
import type { ChatItem } from "@shared/chat";
import type { RewindPreview } from "@shared/models";
import { office } from "../../lib/ipc";
import { Button, Dialog, notifyDone, notifyError } from "../../ui";

type OwnerMessage = Extract<ChatItem, { kind: "user" }>;

export function RewindDialog({ id, messages, initialMessage, terminal, onClose }: {
  id: string;
  messages: OwnerMessage[];
  initialMessage?: string;
  terminal?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(initialMessage);
  const [preview, setPreview] = useState<RewindPreview>();
  const [error, setError] = useState<string>();
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void office.invoke("chat.rewindPreview", { id, messageId: selected }).then((result) => {
      if (!cancelled) setPreview(result);
    }, (failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { cancelled = true; };
  }, [id, selected]);

  const closePreview = () => {
    setSelected(undefined);
    setPreview(undefined);
    setError(undefined);
  };
  const restore = () => {
    if (!selected || !preview) return;
    setApplying(true);
    void office.invoke("chat.rewindFiles", { id, messageId: selected, revision: preview.revision }).then(() => {
      notifyDone("Project files restored", "The agent will be told with your next message.", id);
      onClose();
    }, (failure: unknown) => {
      notifyError(failure, "Could not restore the project files", id);
      closePreview();
    }).finally(() => setApplying(false));
  };
  return <Dialog title={selected ? "Restore files" : "Rewind"} onClose={() => { if (!applying) onClose(); }} footer={<>
    {selected && <Button disabled={applying} onClick={closePreview}>Back</Button>}
    <Button disabled={applying} onClick={onClose}>Close</Button>
    {selected && <Button variant="primary" disabled={applying || !preview?.files.length} onClick={restore}>Restore files</Button>}
    {!selected && terminal && <Button onClick={() => void terminal().then((opened) => { if (opened) onClose(); })}>Rewind the conversation</Button>}
  </>}>
    {selected ? <>
      {error && <p role="alert">{error}</p>}
      {!preview && !error && <p role="status">Checking which files will change…</p>}
      {preview && (preview.files.length ? <>
        <p>Restore the project files to their state before the selected message.</p>
        <ul className="divide-y divide-[var(--line)]">
          {preview.files.map(({ path, action }) => <li key={path} className="flex gap-3 py-1">
            <span className="ui-muted">{action === "create" ? "Add" : action === "delete" ? "Remove" : "Restore"}</span>
            <span className="break-all">{path}</span>
          </li>)}
        </ul>
      </> : <p>{preview.omitted.length ? "No restorable files need changes." : "The project files already match this snapshot."}</p>)}
      {preview && preview.omitted.length > 0 && <details open>
        <summary className="cursor-pointer">Not restorable (untracked and over 50 MB)</summary>
        <ul>{preview.omitted.map((path) => <li key={path} className="break-all py-1">{path}</li>)}</ul>
      </details>}
    </> : <>
      {messages.length ? <>
        <p>Choose a message to preview the files as they were before that turn.</p>
        <ul>{messages.map((message) => <li key={message.id}>
          <button type="button" className="ui-row w-full truncate text-left" data-clickable="true"
            title={message.text} onClick={() => setSelected(message.id)}>
            {message.brief?.title ?? message.text}
          </button>
        </li>)}</ul>
      </> : <p>No file snapshots are available.</p>}
      {terminal && <p className="ui-muted">To rewind Claude's conversation, open it in the terminal and run /rewind.</p>}
    </>}
  </Dialog>;
}
