import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
import { NOTE_SCHEME, parseWikiTarget, splitSections, wikiToLinks } from "@shared/notes";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { Button, Card, EmptyState, Group, LinkButton, notifyError } from "../../ui";

/** The project that owns a vault folder ("Alpha"), so a link into another repo's note can be opened. */
function useVaultOwners(): (folder: string) => string | undefined {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const projects = workspace.data?.workspace?.projects ?? [];
  return (folder) => projects.find((p) => p.vault === folder)?.id;
}

/** Markdown with the wiki links turned into links that open the note in Office; nothing of the syntax shows. */
function NoteMarkdown({ projectId, children }: { projectId: string; children: string }) {
  const navigate = useUi((s) => s.navigate);
  const owner = useVaultOwners();
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          a: ({ href, children: label }) => {
            if (href?.startsWith(NOTE_SCHEME)) {
              const target = parseWikiTarget(decodeURIComponent(href.slice(NOTE_SCHEME.length)));
              const id = target.repo ? owner(target.repo.split("/")[0] ?? "") : projectId;
              // A link to a note nobody can open is plain text, not a dead link.
              if (!id) return <span className="ui-muted">{label}</span>;
              return (
                <LinkButton
                  data-testid="wiki-link"
                  onClick={() =>
                    navigate("project", {
                      id,
                      tab: "notes",
                      note: target.note,
                      ...(target.heading ? { section: target.heading } : {}),
                    })
                  }
                >
                  {label}
                </LinkButton>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            );
          },
        }}
      >
        {wikiToLinks(children)}
      </ReactMarkdown>
    </div>
  );
}

/** A line of text from the notes (a check's message, an audit entry) with its links working and no syntax showing. */
export function NoteText({ children }: { children: string }) {
  return <NoteMarkdown projectId="">{children}</NoteMarkdown>;
}

/** A project's notes as formatted documents: a summary line, a contents list, sections that fold, and the source. */
export function Notes({
  id,
  initial,
  section,
}: {
  id: string;
  initial?: string;
  section?: string;
}) {
  const [name, setName] = useState(initial ?? "Overview");
  const [more, setMore] = useState(false);
  const list = useQuery("notes.list", { projectId: id }, ["vault.changed"]);
  const note = useQuery("notes.read", { projectId: id, name }, ["vault.changed"]);
  // Which sections are open: the first one, and any the owner opened or a link pointed at.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const entries = list.data ?? [];
  const calm = entries.filter((e) => !e.rare || e.name === name);
  const rare = entries.filter((e) => e.rare && e.name !== name);
  const doc = note.data?.exists ? splitSections(note.data.markdown) : null;
  const isOpen = (title: string, index: number): boolean =>
    opened[title] ?? (section ? title.toLowerCase() === section.toLowerCase() : index === 0);
  const pick = (next: string): void => {
    setName(next);
    setOpened({});
  };

  const openSource = (): void => {
    void office
      .invoke("notes.openFile", { projectId: id, name })
      .catch((err: unknown) =>
        notifyError(err, "Could not open that note in your editor", "notes"),
      );
  };
  return (
    <Card
      title="Notes"
      testId="panel-notes"
      action={
        <div className="flex flex-wrap gap-1" data-testid="note-picker">
          {calm.map((n) => (
            <Button
              key={n.name}
              size="sm"
              variant={n.name === name ? "primary" : "secondary"}
              title={n.summary ?? undefined}
              onClick={() => pick(n.name)}
              data-testid="note-pick"
            >
              {n.name}
            </Button>
          ))}
          {rare.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMore(!more)}
              data-testid="notes-more"
            >
              {more ? "Show fewer" : "Show more"}
            </Button>
          )}
          {more &&
            rare.map((n) => (
              <Button
                key={n.name}
                size="sm"
                variant="secondary"
                title={n.summary ?? undefined}
                onClick={() => pick(n.name)}
                data-testid="note-pick"
              >
                {n.name}
              </Button>
            ))}
        </div>
      }
    >
      {note.data && !note.data.exists && (
        <EmptyState title={`No ${name} note`}>This project has no {name} note yet.</EmptyState>
      )}
      {note.data?.exists && doc && (
        <div className="reading" data-testid="note-doc">
          {note.data.summary && (
            <p className="mt-0 ui-muted" data-testid="note-summary">
              {note.data.summary}
            </p>
          )}
          {doc.sections.length > 1 && (
            <nav aria-label="Contents" className="mb-3" data-testid="note-contents">
              <Group>Contents</Group>
              <ul className="m-0 grid list-none gap-1 p-0">
                {doc.sections.map((s, i) => (
                  <li key={s.title}>
                    <LinkButton
                      onClick={() => {
                        setOpened((now) => ({ ...now, [s.title]: true }));
                        document
                          .getElementById(`note-section-${i}`)
                          ?.scrollIntoView({ block: "start", behavior: "smooth" });
                      }}
                    >
                      {s.title}
                    </LinkButton>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {doc.intro && <NoteMarkdown projectId={id}>{doc.intro}</NoteMarkdown>}
          {doc.sections.map((s, i) => (
            <details
              key={`${name}-${s.title}`}
              id={`note-section-${i}`}
              className="note-section"
              open={isOpen(s.title, i)}
              onToggle={(e) => {
                const open = (e.currentTarget as HTMLDetailsElement).open;
                setOpened((now) => (now[s.title] === open ? now : { ...now, [s.title]: open }));
              }}
              data-testid="note-section"
            >
              <summary className="font-semibold">{s.title}</summary>
              <NoteMarkdown projectId={id}>{s.body}</NoteMarkdown>
            </details>
          ))}
          <div
            className="ui-line-sub mt-3 flex flex-wrap items-center gap-2"
            data-testid="note-source"
          >
            <span>Source: {note.data.source}</span>
            <LinkButton onClick={openSource} data-testid="note-open-editor">
              Open in editor
            </LinkButton>
          </div>
        </div>
      )}
    </Card>
  );
}
