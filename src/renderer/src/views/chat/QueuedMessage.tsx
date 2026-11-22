import { useState } from "react";
import type { QueuedMessage as Message } from "@shared/models";
import { Button, Textarea } from "../../ui";

export function QueuedMessage({ message, working, onEdit, onRemove, onSend }: {
  message: Message;
  working: boolean;
  onEdit: (text: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onSend: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string>();
  const [pending, setPending] = useState(false);
  const run = (action: () => Promise<boolean>) => {
    setPending(true);
    void action().then((done) => { if (done) setDraft(undefined); }).finally(() => setPending(false));
  };

  return <div className="bubble-row user" data-testid="queued-message">
    <div className="bubble text-selectable">
      <div className="bubble-note">Queued{message.images > 0 && ` · ${message.images} attached`}</div>
      {draft === undefined
        ? <p className="whitespace-pre-wrap break-words">{message.text}</p>
        : <Textarea label="Edit queued message" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} />}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        {draft === undefined ? <>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDraft(message.text)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(onRemove)}>Remove</Button>
          <Button size="sm" disabled={pending} onClick={() => run(onSend)}>{working ? "Send now" : "Send"}</Button>
        </> : <>
          <Button size="sm" disabled={pending} onClick={() => setDraft(undefined)}>Cancel</Button>
          <Button size="sm" disabled={pending || !draft.trim()} onClick={() => run(() => onEdit(draft.trim()))}>Save</Button>
        </>}
      </div>
    </div>
  </div>;
}
