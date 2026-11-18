import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HealthView, HubRepoRow } from "../../../shared/models";
import { run } from "../../core/exec";
import { git } from "../git/run";

/** Runs `node Common/tools/brain.mjs validate` from the hub root and parses its report. */
export async function runValidate(root: string): Promise<HealthView["validate"]> {
  const tool = join(root, "Common", "tools", "brain.mjs");
  if (!existsSync(tool)) {
    return { ran: false, ok: true, errors: [], warnings: 0, summary: null };
  }
  const result = await run("node", [tool, "validate"], { cwd: root, timeoutMs: 120_000 });
  return parseValidate(result.stdout, result.code);
}

/** `ERROR ...` lines are errors, `warn ...` lines are warnings, the last `hub:` line is the summary. */
export function parseValidate(stdout: string, code: number): HealthView["validate"] {
  const errors: string[] = [];
  let warnings = 0;
  let summary: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("ERROR ")) errors.push(line.slice(6).trim());
    else if (line.startsWith("warn ")) warnings++;
    else if (/^\S+: \d+ files, \d+ errors/.test(line)) summary = line.trim();
  }
  return { ran: true, ok: code === 0 && errors.length === 0, errors, warnings, summary };
}

const PAD = 26;

/** Parses `node tools/hub.mjs status` into one row per repo. */
export function parseHubStatus(stdout: string): HubRepoRow[] {
  const rows: HubRepoRow[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (raw.length <= PAD || raw[PAD] !== " ") continue;
    const folder = raw.slice(0, PAD).trim();
    if (!folder || /\s/.test(folder)) continue;
    const body = raw.slice(PAD).trim();
    const dated = /^(\d{4}-\d{2}-\d{2}|-)\s+(.*)$/.exec(body);
    const last = dated?.[1] ?? "";
    const state = (dated ? dated[2] : body) ?? "";
    const num = (re: RegExp): number => Number(re.exec(state)?.[1] ?? 0);
    rows.push({
      folder,
      last,
      state,
      uncommitted: num(/(\d+) uncommitted/),
      ahead: num(/(\d+) to push/),
      behind: num(/(\d+) to pull/),
      attention: state !== "clean",
    });
  }
  return rows;
}

export async function readHubStatus(root: string): Promise<HubRepoRow[]> {
  const tool = join(root, "tools", "hub.mjs");
  if (!existsSync(tool)) return [];
  const result = await run("node", [tool, "status"], { cwd: root, timeoutMs: 60_000 });
  const rows = parseHubStatus(result.stdout);
  // The tool's table has no branch; each repo is asked directly.
  return Promise.all(
    rows.map(async (row) => {
      const dir = row.folder === "." ? root : join(root, row.folder);
      if (!existsSync(dir)) return row;
      const head = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = head.stdout.trim();
      return head.code === 0 && branch ? { ...row, branch } : row;
    }),
  );
}
