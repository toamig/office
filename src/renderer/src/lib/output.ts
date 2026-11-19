const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*${BEL}`, "g");
const URL_IN_OUTPUT = new RegExp(`https?://[^\\s"'<>${ESC}]+`);

/** The first web address in what the program printed, with the colour codes taken out. */
export function firstUrl(output: string): string | null {
  return URL_IN_OUTPUT.exec(output.replace(ANSI, ""))?.[0] ?? null;
}
