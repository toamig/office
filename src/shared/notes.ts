/** Helpers for showing a note as a document: wiki links become links, and long notes fold by section. */

/** The scheme of a link to another note; the target is what was written between the brackets. */
export const NOTE_SCHEME = "office-note:";

export interface WikiTarget {
  /** The folder of the note's repo ("Alpha"), when the link names one. */
  repo: string | null;
  /** The note's name, without ".md". */
  note: string;
  /** The heading it points at, if any. */
  heading: string | null;
}

/** Reads `Repo/Note#Heading`, `Note#Heading` or `Note` (a link may carry a label after a bar, which the caller removes). */
export function parseWikiTarget(raw: string): WikiTarget {
  const [path = "", heading] = raw.trim().split("#");
  const parts = path.split("/").filter(Boolean);
  const note = (parts.pop() ?? "").replace(/\.md$/i, "");
  return {
    repo: parts.length > 0 ? parts.join("/") : null,
    note,
    heading: heading?.trim() || null,
  };
}

/** The words a wiki link shows: its label when it has one, else the note's name (and heading). */
export function wikiLabel(raw: string): string {
  const bar = raw.indexOf("|");
  if (bar >= 0) return raw.slice(bar + 1).trim();
  const t = parseWikiTarget(raw);
  return t.heading ? `${t.note}, ${t.heading}` : t.note;
}

/**
 * Turns every `[[Repo/Note#Heading|label]]` outside code into an ordinary markdown link with the note scheme, so no
 * bracket syntax is ever drawn. Code spans and fenced blocks are left as they are.
 */
export function wikiToLinks(markdown: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      // Skip inline code: only the parts outside backticks are changed.
      return line
        .split(/(`[^`]*`)/)
        .map((part) =>
          part.startsWith("`")
            ? part
            : part.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
                const bar = inner.indexOf("|");
                const target = bar >= 0 ? inner.slice(0, bar) : inner;
                return `[${wikiLabel(inner)}](${NOTE_SCHEME}${encodeURIComponent(target.trim())})`;
              }),
        )
        .join("");
    })
    .join("\n");
}

export interface NoteSection {
  title: string;
  level: number;
  /** The markdown under the heading, up to the next heading of the same or a higher level. */
  body: string;
}

export interface SplitNote {
  /** What comes before the first heading. */
  intro: string;
  sections: NoteSection[];
}

/** Splits a note at its `##` headings (outside code), so long sections can fold. A `#` title stays in the intro. */
export function splitSections(markdown: string): SplitNote {
  const intro: string[] = [];
  const sections: NoteSection[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced ? /^(#{2})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading) {
      sections.push({ title: heading[2] ?? "", level: 2, body: "" });
      continue;
    }
    const target = sections.at(-1);
    if (target) target.body += `${line}\n`;
    else intro.push(line);
  }
  return {
    intro: intro.join("\n").trim(),
    sections: sections.map((s) => ({ ...s, body: s.body.trim() })),
  };
}

/** Notes the owner rarely needs: content audits and implementation notes sit behind Show more. */
export function isRareNote(name: string, type?: string | null): boolean {
  return /audit|implementation/i.test(name) || /audit|implementation/i.test(type ?? "");
}
