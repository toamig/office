import { useEffect, useState } from "react";
import type { OfficeConfirmation } from "@shared/office-tools";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Button, Dropdown, Input, Textarea, notifyError } from "../ui";

type Field = OfficeConfirmation["fields"][number];
type Value = NonNullable<Field["value"]> | null;

function EditField({ field, value, onChange }: {
  field: Field;
  value: Field["value"];
  onChange: (value: Value) => void;
}) {
  const text = value == null ? "" : String(value);
  const changeText = (next: string) => onChange(next === "" && field.nullable ? null : next);
  if (field.kind === "boolean") {
    return <label className="flex items-center gap-2">
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      {field.label}
    </label>;
  }
  if (field.options) {
    return <label className="grid gap-1">
      {field.label}
      <Dropdown value={text} onChange={(e) => changeText(e.target.value)}>
        {(!text || field.nullable) && <option value="">{field.key === "projectId" ? "Brain" : "Choose"}</option>}
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Dropdown>
    </label>;
  }
  if (field.kind === "multiline")
    return <Textarea label={field.label} rows={3} value={text} onChange={(e) => changeText(e.target.value)} />;
  return <Input label={field.label} type={field.kind === "number" ? "number" : field.key === "date" ? "date" : "text"}
    value={text} onChange={(e) => {
      if (field.kind === "number") {
        if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
      } else changeText(e.target.value);
    }} />;
}

function Confirmation({ card, sessionId, reload }: {
  card: OfficeConfirmation;
  sessionId: string;
  reload: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, Value>>({});
  const answer = async (save: boolean) => {
    setSaving(true);
    try {
      await office.invoke("office.confirm", { sessionId, id: card.id, save, ...(editing ? { edits } : {}) });
      reload();
    } catch (error) {
      notifyError(error, "Could not complete the Office action", card.id);
      setSaving(false);
    }
  };
  return (
    <section className="ui-ask min-w-0" aria-label={card.title} data-testid="office-confirmation">
      <h3 className="font-semibold">{card.title}</h3>
      {editing ? (
        <div className="grid gap-2">
          {card.fields.map((field) => (
            <EditField key={field.key} field={field}
              value={Object.hasOwn(edits, field.key) ? edits[field.key] : field.value}
              onChange={(value) => setEdits((previous) => ({ ...previous, [field.key]: value }))} />
          ))}
          {edits["visibility"] === "public" && <p className="ui-muted">Saving will create a public repository.</p>}
        </div>
      ) : (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
          {card.preview.map(({ label, text }) => (
            <div className="contents" key={label}>
              <dt className="ui-muted">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">{text}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={saving} onClick={() => void answer(true)}>Save</Button>
        {card.fields.length > 0 && <Button disabled={saving} onClick={() => {
          if (editing) setEdits({});
          setEditing(!editing);
        }}>
          {editing ? "Cancel edit" : "Edit"}
        </Button>}
        <Button disabled={saving} onClick={() => void answer(false)}>Discard</Button>
      </div>
    </section>
  );
}

export function OfficeConfirmations({ sessionId, onReveal }: { sessionId: string; onReveal?: () => void }) {
  const pending = useQuery("office.confirmations", { sessionId }, ["office.confirmation"]);
  const lastId = pending.data?.at(-1)?.id;
  useEffect(() => { if (lastId) onReveal?.(); }, [lastId, onReveal]);
  return pending.data?.map((card) => <Confirmation key={card.id} card={card} sessionId={sessionId} reload={pending.reload} />);
}
