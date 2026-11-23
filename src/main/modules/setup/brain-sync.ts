import { run } from "../../core/exec";
import type { BrainSyncState } from "../../../shared/models";

/** The Windows task that keeps the Brain in step runs without Office; Office only reads its state. */
export const BRAIN_SYNC_TASK = "Brain auto-sync";

function csvRow(line: string): string[] {
  return [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((match) => (match[1] ?? match[2] ?? "").replaceAll('""', '"').trim());
}

/** Reads the one data row of `schtasks /query /fo CSV /v /nh`: host, name, next run, status, mode, last run, last result. */
export function parseBrainSync(output: string): BrainSyncState {
  const row = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('"'));
  if (!row) return { state: "missing", next: null, last: null, lastResultOk: null };
  const cells = csvRow(row);
  const status = (cells[3] ?? "").toLowerCase();
  const result = Number(cells[6]);
  const clean = (value: string | undefined): string | null => value && !/^n\/a$/i.test(value) ? value : null;
  return {
    state: status === "disabled" ? "off" : "on",
    next: clean(cells[2]),
    last: clean(cells[5]),
    lastResultOk: Number.isFinite(result) ? result === 0 : null,
  };
}

export async function readBrainSync(): Promise<BrainSyncState> {
  if (process.platform !== "win32") return { state: "unsupported", next: null, last: null, lastResultOk: null };
  const result = await run("schtasks", ["/query", "/tn", BRAIN_SYNC_TASK, "/fo", "CSV", "/v", "/nh"], { timeoutMs: 10_000 });
  return result.code === 0 ? parseBrainSync(result.stdout) : { state: "missing", next: null, last: null, lastResultOk: null };
}
