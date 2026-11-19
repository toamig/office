/** The agent pointer: a block between markers in a code repo's AGENTS.md or CLAUDE.local.md (plan M9.3). Pure text, so it is easy to test. */

export const POINTER_BEGIN = "<!-- office:begin -->";
export const POINTER_END = "<!-- office:end -->";
const LEAD = /<!-- office:lead=(\d) -->/;

/** Which file the block goes in: AGENTS.md (committed, read by every agent tool) or CLAUDE.local.md (this PC only). */
export type PointerTarget = "agents" | "local";

export const TARGET_FILE: Record<PointerTarget, string> = {
  agents: "AGENTS.md",
  local: "CLAUDE.local.md",
};

/** A public repo gets the local file, because the block holds a path that only exists on this PC; anything else, or a failed check, gets AGENTS.md. */
export function defaultTarget(visibility: string | null): PointerTarget {
  return visibility?.toLowerCase() === "public" ? "local" : "agents";
}

export interface PointerInfo {
  name: string;
  /** The absolute path of the notes folder on this PC, with forward slashes: a place an agent can open. */
  notesPath: string;
  /** The notes folder relative to the brain, for the reader's orientation. */
  notesFolder: string;
  /** The brain's git remote, when it has one. */
  remote: string | null;
}

/** The block, without the lead marker. */
export function pointerBlock(info: PointerInfo): string {
  return [
    POINTER_BEGIN,
    "## Notes for this project",
    "",
    `The notes for ${info.name} are in \`${info.notesPath}\` (the folder \`${info.notesFolder}\` of the brain).`,
    ...(info.remote ? [`The brain's git remote is \`${info.remote}\`.`] : []),
    "Read `Overview.md` there first. Record decisions in it, and what is left to do in `OpenItems.md`; what waits on",
    'the owner goes under its "Waiting on you" heading.',
    POINTER_END,
    "",
  ].join("\n");
}

/** Where the block goes in text that already exists: after it, with a blank line between. */
function leadFor(text: string): string {
  if (text === "") return "";
  return text.endsWith("\n") ? "\n" : "\n\n";
}

/** The text of the file with the block added. Nothing before the block changes. */
export function installPointer(original: string | null, block: string): string {
  const base = original ?? "";
  const lead = leadFor(base);
  const withMarker = block.replace(
    POINTER_BEGIN,
    `${POINTER_BEGIN} <!-- office:lead=${lead.length} -->`,
  );
  return base + lead + withMarker;
}

/** Whether the text has the block. */
export const hasPointer = (text: string): boolean =>
  text.includes(POINTER_BEGIN) && text.includes(POINTER_END);

/** The text without the block and without the line breaks install added before it: the original, byte for byte. */
export function removePointer(text: string): string {
  const begin = text.indexOf(POINTER_BEGIN);
  const endAt = text.indexOf(POINTER_END);
  if (begin < 0 || endAt < begin) return text;
  const lineEnd = text.indexOf("\n", endAt);
  const after = lineEnd < 0 ? "" : text.slice(lineEnd + 1);
  const beginLine = text.slice(
    begin,
    text.indexOf("\n", begin) < 0 ? undefined : text.indexOf("\n", begin),
  );
  const lead = Number(LEAD.exec(beginLine)?.[1] ?? 0);
  let before = text.slice(0, begin);
  if (lead > 0 && before.endsWith("\n".repeat(lead)))
    before = before.slice(0, before.length - lead);
  return before + after;
}
