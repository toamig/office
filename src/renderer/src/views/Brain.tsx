import { X } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../components/Markdown";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import {
  Banner,
  Button,
  Card,
  Dropdown,
  EmptyState,
  Group,
  IconButton,
  Input,
  Page,
  ShortPath,
  SplitPane,
  StatusBadge,
  notifyDone,
  notifyError,
} from "../ui";
import { describeValidate } from "@shared/health";
import { AuditItem, ProblemItem, RepoItem, ShowDetails } from "../components/HealthItems";
import { AskPanel } from "./brain/AskPanel";

function QuickNote() {
  const projects = useQuery("projects.list");
  const [project, setProject] = useState("");
  const [text, setText] = useState("");

  const save = async (): Promise<void> => {
    try {
      const result = await office.invoke("vault.addNote", { projectId: project, text });
      setText("");
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
    <Card title="Quick note" testId="panel-quick-note">
      <p className="ui-muted mt-0">
        Jot a thought against a project. It is saved under &quot;Notes to file&quot; and committed;
        an agent files it properly later.
      </p>
      <div className="flex items-end gap-2">
        <Dropdown
          value={project}
          onChange={(e) => setProject(e.target.value)}
          aria-label="Note project"
          data-testid="note-project"
        >
          <option value="">Project...</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Dropdown>
        <Input
          className="flex-1"
          label="Note text"
          hideLabel
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="note-text"
          placeholder="What do you want to remember?"
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
    </Card>
  );
}

function BrainHealth() {
  const health = useQuery("vault.health", undefined, ["vault.health"]);
  const audit = useQuery("vault.audit", undefined, ["vault.changed"]);
  const validate = health.data?.validate;
  const attention = (health.data?.repos ?? []).filter((r) => r.attention);
  const problems = validate?.problems ?? [];
  return (
    <Card title="Brain health" testId="panel-brain-health">
      {validate && !validate.ran && (
        <EmptyState title="Brain tools not available">
          The brain tools are not available in this workspace.
        </EmptyState>
      )}
      {validate?.ran && (
        <>
          <div className="ui-line" data-testid="health-summary">
            <StatusBadge
              status={validate.ok ? "passed" : "failed"}
              label={validate.ok ? "Checks pass" : "Checks fail"}
            />
            <span className="ui-muted ui-line-main">{describeValidate(validate)}</span>
          </div>
          <ShowDetails output={validate.output} />
        </>
      )}
      {problems.map((p) => (
        <ProblemItem key={`${p.level}-${p.message}`} problem={p} />
      ))}
      {attention.map((r) => (
        <RepoItem key={r.folder} repo={r} />
      ))}
      {validate?.ran && attention.length === 0 && problems.length === 0 && (
        <StatusBadge status="in-sync" label="Every repo is committed and in step" />
      )}
      <Group>Open content-audit entries</Group>
      {audit.data?.length === 0 && <p className="ui-muted m-0">No open entries.</p>}
      {audit.data?.map((a) => (
        <div key={a.repo} className="mb-1">
          <span className="font-medium">{a.repo}</span>
          {a.entries.map((e) => (
            <AuditItem key={e} repo={a.repo} entry={e} />
          ))}
        </div>
      ))}
    </Card>
  );
}

function NoteViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const note = useQuery("vault.readFile", { path });
  return (
    <Card
      title="Note"
      testId="panel-note"
      action={
        <IconButton label="Close note" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      }
    >
      <div data-testid="note-viewer">
        <p className="mt-0">
          <ShortPath path={path} keep={4} />
        </p>
        {note.error && <Banner tone="danger">{note.error}</Banner>}
        {note.data && (
          <div className="reading">
            <Markdown>{note.data.markdown}</Markdown>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Ask the brain, quick notes and brain health. */
export function Brain() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Page
      title="Brain"
      subtitle="The notes you and your agents share, and whether they are healthy."
      testId="brain"
      fill
    >
      <SplitPane
        id="brain"
        defaultSize={620}
        min={360}
        minSecond={360}
        first={
          <div className="grid content-start gap-4 pr-4">
            <AskPanel onOpenNote={setOpen} />
            <QuickNote />
          </div>
        }
        second={
          <div className="grid content-start gap-4 pl-4">
            {open && <NoteViewer key={open} path={open} onClose={() => setOpen(null)} />}
            <BrainHealth />
          </div>
        }
      />
    </Page>
  );
}
