import type { TodoGroup, WaitingItem } from "../../../shared/models";
import { localDate } from "../brief/brief";

const ITEM_RE = /^- \[ \] (\d{4}-\d{2}-\d{2}) (.+?)(?: \(([^()]*)\))?\s*$/;
const H2_RE = /^## (.+?)\s*$/;
export const REMINDER_SOURCE = "Office reminder";

export function waitingIsDue(item: WaitingItem, now = new Date()): boolean {
  return item.source !== REMINDER_SOURCE || item.date <= localDate(now);
}

/** Splits a "Waiting on you" line into date, text and optional source; null if it does not match. */
export function parseWaitingLine(
  line: string,
): { date: string; text: string; source?: string } | null {
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  return { date: m[1] ?? "", text: m[2] ?? "", ...(m[3] ? { source: m[3] } : {}) };
}

export interface ParsedOpenItems {
  waiting: WaitingItem[];
  unparsed: Array<{ line: number; text: string }>;
  groups: TodoGroup[];
}

/** Index of the first line after the YAML frontmatter block (0 when there is none). */
function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i]?.trim() === "---") return i + 1;
  return 0;
}

/**
 * Parses an OpenItems file (plan 5.5). The "Waiting on you" section yields dated items and keeps
 * every other non-blank line as "unparsed"; every other `## ` section yields a todo group.
 */
export function parseOpenItems(
  markdown: string,
  waitingHeading = "Waiting on you",
): ParsedOpenItems {
  const lines = markdown.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: ParsedOpenItems = { waiting: [], unparsed: [], groups: [] };
  let heading: string | null = null;
  let group: TodoGroup | null = null;
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const text = lines[i] ?? "";
    const h = H2_RE.exec(text);
    if (h) {
      heading = h[1] ?? "";
      group = null;
      if (heading !== waitingHeading) {
        group = { heading, items: [] };
        out.groups.push(group);
      }
      continue;
    }
    if (heading === null) continue;
    if (heading === waitingHeading) {
      if (text.trim() === "") continue;
      const m = ITEM_RE.exec(text);
      if (m) {
        out.waiting.push({
          date: m[1] ?? "",
          text: m[2] ?? "",
          ...(m[3] ? { source: m[3] } : {}),
          raw: text,
          line: i + 1,
        });
      } else {
        out.unparsed.push({ line: i + 1, text });
      }
    } else if (group && text.startsWith("- ")) {
      const box = /^- \[( |x|X)\] (.*)$/.exec(text);
      group.items.push(
        box
          ? { text: box[2] ?? "", checked: box[1] !== " ", line: i + 1 }
          : { text: text.slice(2), checked: null, line: i + 1 },
      );
    }
  }
  return out;
}

/**
 * Ticks or unticks the todo on a 1-based line of a section other than "Waiting on you". A plain bullet
 * becomes a checkbox line. Null when that line is no longer the item the owner saw (the file moved on).
 */
export function setTodoChecked(
  markdown: string,
  line: number,
  text: string,
  checked: boolean,
): string | null {
  const eol = eolOf(markdown);
  const lines = markdown.split(/\r?\n/);
  const current = lines[line - 1];
  if (current === undefined) return null;
  const m = /^- (?:\[( |x|X)\] )?(.*)$/.exec(current);
  if (!m || m[2] !== text) return null;
  lines[line - 1] = `- [${checked ? "x" : " "}] ${text}`;
  return lines.join(eol);
}

const eolOf = (markdown: string): string => (markdown.includes("\r\n") ? "\r\n" : "\n");

/** Formats a new "Waiting on you" line. `source` goes in trailing parentheses. */
export function formatWaitingLine(date: string, text: string, source?: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return `- [ ] ${date} ${clean}${source ? ` (${source.replace(/[()]/g, "")})` : ""}`;
}

/** Removes exactly one line (the first exact match inside the waiting section). Null if absent. */
export function removeWaitingLine(
  markdown: string,
  raw: string,
  waitingHeading = "Waiting on you",
): string | null {
  const lines = markdown.split("\n");
  let inSection = false;
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const text = (lines[i] ?? "").replace(/\r$/, "");
    const h = H2_RE.exec(text);
    if (h) {
      inSection = h[1] === waitingHeading;
      continue;
    }
    if (inSection && text === raw) {
      lines.splice(i, 1);
      return lines.join("\n");
    }
  }
  return null;
}

/**
 * Appends a line to the end of a `## <heading>` section, creating the section when missing:
 * before the first other `## ` section, or at the end of the file when there is none.
 */
export function appendToSection(markdown: string, heading: string, line: string): string {
  const eol = eolOf(markdown);
  const lines = markdown.split("\n");
  const start = bodyStart(lines);
  let sectionAt = -1;
  let nextAt = lines.length;
  let firstH2 = -1;
  for (let i = start; i < lines.length; i++) {
    const h = H2_RE.exec((lines[i] ?? "").replace(/\r$/, ""));
    if (!h) continue;
    if (firstH2 < 0) firstH2 = i;
    if (sectionAt >= 0) {
      nextAt = i;
      break;
    }
    if (h[1] === heading) sectionAt = i;
  }
  if (sectionAt >= 0) {
    let insertAt = nextAt;
    while (insertAt > sectionAt + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;
    lines.splice(insertAt, 0, line + (eol === "\r\n" ? "\r" : ""));
    if (insertAt === sectionAt + 1) lines.splice(insertAt, 0, eol === "\r\n" ? "\r" : "");
    return lines.join("\n");
  }
  const block = [`## ${heading}`, "", line, ""].map((l) => (eol === "\r\n" && l ? `${l}\r` : l));
  if (firstH2 >= 0) {
    lines.splice(firstH2, 0, ...block);
    return lines.join("\n");
  }
  const trimmed = markdown.replace(/\s+$/, "");
  return `${trimmed}${eol}${eol}## ${heading}${eol}${eol}${line}${eol}`;
}
