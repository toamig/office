import { X } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../components/Markdown";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../components/ui";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";
import { AskPanel } from "./brain/AskPanel";

function QuickNote() {
  const projects = useQuery("projects.list");
  const [project, setProject] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const result = await office.invoke("vault.addNote", { projectId: project, text });
      setText("");
      setMessage(
        result.pushed ? "Noted and pushed." : "Noted. It will be pushed on the next sync.",
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Panel title="Quick note">
      <p className="mt-0 text-[12.5px]" style={{ color: "var(--muted)" }}>
        Jot a thought against a project. It is saved under &quot;Notes to file&quot; and committed;
        an agent files it properly later.
      </p>
      {error && <ErrorBanner message={error} />}
      {message && (
        <div className="mb-2" data-testid="note-message">
          <Chip tone="good">{message}</Chip>
        </div>
      )}
      <div className="flex gap-2">
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          aria-label="Note project"
          data-testid="note-project"
          className="rounded border px-1 py-0.5"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--text)" }}
        >
          <option value="">Project...</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Note text"
          data-testid="note-text"
          placeholder="What do you want to remember?"
          className="flex-1 rounded border px-2 py-1"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
        />
        <Button
          variant="primary"
          disabled={!project || !text.trim()}
          onClick={() => void save()}
          data-testid="note-save"
        >
          Save
        </Button>
      </div>
    </Panel>
  );
}

function BrainHealth() {
  const health = useQuery("vault.health", undefined, ["vault.changed"]);
  const audit = useQuery("vault.audit", undefined, ["vault.changed"]);
  const validate = health.data?.validate;
  const attention = (health.data?.repos ?? []).filter((r) => r.attention);
  return (
    <Panel title="Brain health">
      {validate && !validate.ran && (
        <EmptyState>The brain tools are not available in this workspace.</EmptyState>
      )}
      {validate?.ran && (
        <div className="mb-2 flex items-center gap-2">
          <Chip tone={validate.ok ? "good" : "bad"}>
            {validate.ok ? "validate passes" : "validate fails"}
          </Chip>
          <span style={{ color: "var(--muted)" }}>{validate.summary}</span>
        </div>
      )}
      {validate?.errors.map((e) => (
        <div key={e} className="text-[12.5px]" style={{ color: "#cf4a4a" }}>
          {e}
        </div>
      ))}
      {attention.map((r) => (
        <div key={r.folder} className="py-0.5">
          <Chip tone="warn">{r.folder}</Chip> {r.state}
        </div>
      ))}
      {validate?.ran && attention.length === 0 && (
        <Chip tone="good">every repo is committed and in step</Chip>
      )}
      <h3 className="mb-1 mt-3 text-[13px] font-semibold">Open content-audit entries</h3>
      {audit.data?.length === 0 && <EmptyState>No open entries.</EmptyState>}
      {audit.data?.map((a) => (
        <div key={a.repo} className="mb-1">
          <span className="font-medium">{a.repo}</span>
          <ul className="m-0 pl-5">
            {a.entries.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ))}
    </Panel>
  );
}

function NoteViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const note = useQuery("vault.readFile", { path });
  return (
    <Panel
      title={path}
      action={
        <Button variant="ghost" aria-label="Close note" onClick={onClose}>
          <X size={14} />
        </Button>
      }
    >
      <div data-testid="note-viewer">
        {note.error && <ErrorBanner message={note.error} />}
        {note.data && <Markdown>{note.data.markdown}</Markdown>}
      </div>
    </Panel>
  );
}

/** Ask the brain, quick notes and brain health. */
export function Brain() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2" data-testid="brain">
      <div className="grid content-start gap-4">
        <AskPanel onOpenNote={setOpen} />
        <QuickNote />
      </div>
      <div className="grid content-start gap-4">
        {open && <NoteViewer key={open} path={open} onClose={() => setOpen(null)} />}
        <BrainHealth />
      </div>
    </div>
  );
}
