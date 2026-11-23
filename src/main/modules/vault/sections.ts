const H2_RE = /^## (.+?)\s*$/;

/** Index of the first line after the YAML frontmatter block (0 when there is none). */
function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i]?.trim() === "---") return i + 1;
  return 0;
}

const eolOf = (markdown: string): string => (markdown.includes("\r\n") ? "\r\n" : "\n");

/** Replaces the body of a `## ` section with new lines; the section is added at the end when it is not there. */
export function replaceSection(markdown: string, heading: string, body: string[]): string {
  const eol = eolOf(markdown);
  const lines = markdown.split("\n");
  let sectionAt = -1;
  let nextAt = lines.length;
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const h = H2_RE.exec((lines[i] ?? "").replace(/\r$/, ""));
    if (!h) continue;
    if (sectionAt >= 0) {
      nextAt = i;
      break;
    }
    if (h[1] === heading) sectionAt = i;
  }
  if (sectionAt < 0) return `${markdown.replace(/\s+$/, "")}${eol}${eol}## ${heading}${eol}${eol}${body.join(eol)}${eol}`;
  const block = ["", ...body, ""].map((line) => (eol === "\r\n" && line ? `${line}\r` : line));
  lines.splice(sectionAt + 1, nextAt - sectionAt - 1, ...block);
  return lines.join("\n");
}

/** The lines of a `## ` section, or null when it is not there. */
export function sectionLines(markdown: string, heading: string): string[] | null {
  const lines = markdown.split("\n").map((line) => line.replace(/\r$/, ""));
  let at = -1;
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const h = H2_RE.exec(lines[i] ?? "");
    if (!h) continue;
    if (at >= 0) return lines.slice(at + 1, i);
    if (h[1] === heading) at = i;
  }
  return at >= 0 ? lines.slice(at + 1) : null;
}
