/** The agent pointer: a block between markers in a code repo's AGENTS.md (plan M9.3). Pure text, so it is easy to test. */

export const POINTER_BEGIN = "<!-- office:begin -->";
export const POINTER_END = "<!-- office:end -->";
const LEAD = /<!-- office:lead=(\d) -->/;

export interface PointerInfo {
  name: string;
  /** Where the notes are, without a path that only exists on this PC: the brain's folder name and the notes folder. */
  brain: string;
  notesFolder: string;
}

/** The block, without the lead marker. */
export function pointerBlock(info: PointerInfo): string {
  return [
    POINTER_BEGIN,
    "## Notes for this project",
    "",
    `The notes for ${info.name} are in the brain \`${info.brain}\`, in the folder \`${info.notesFolder}\`.`,
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
