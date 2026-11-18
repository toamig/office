import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DiffFile, DiffHunk, DiffLine, DiffResult } from "../../../shared/models";
import { IpcFailure } from "../../core/ipc";
import { git } from "./run";
import { readStatus } from "./status";

const MAX_LINES_PER_FILE = 3000;
const MAX_UNTRACKED_BYTES = 200_000;

const stripPrefix = (p: string): string => p.replace(/^[ab]\//, "");

/** Parses unified diff text (`git diff --no-color`) into files, hunks and numbered lines. Pure. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let lineCount = 0;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      file = {
        path: m?.[2] ?? "",
        oldPath: null,
        status: "modified",
        binary: false,
        additions: 0,
        deletions: 0,
        truncated: false,
        hunks: [],
      };
      files.push(file);
      hunk = null;
      lineCount = 0;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = line.slice("rename from ".length);
      } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch"))
        file.binary = true;
      else if (line.startsWith("--- ") && line !== "--- /dev/null")
        file.oldPath = file.oldPath ?? stripPrefix(line.slice(4));
      else if (line.startsWith("+++ ") && line !== "+++ /dev/null")
        file.path = stripPrefix(line.slice(4));
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) {
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      continue;
    }
    if (!hunk) continue;
    if (lineCount >= MAX_LINES_PER_FILE) {
      file.truncated = true;
      continue;
    }
    const mark = line[0];
    let entry: DiffLine | null = null;
    if (mark === "+") {
      entry = { kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) };
      file.additions++;
    } else if (mark === "-") {
      entry = { kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) };
      file.deletions++;
    } else if (mark === " ") {
      entry = { kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) };
    }
    if (entry) {
      hunk.lines.push(entry);
      lineCount++;
    }
  }
  for (const f of files) if (f.oldPath === f.path) f.oldPath = null;
  return files;
}

/** A synthetic "new file" diff for an untracked text file, so new files show up in the review. */
export function untrackedAsDiff(path: string, content: string): string {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    "",
  ].join("\n");
}

export type DiffMode = "working" | "staged" | "branch";

/**
 * The changes to review in a checkout. `working` is everything uncommitted (staged, unstaged and new
 * files); `staged` is what a commit would take; `branch` is the branch against a base (`base...HEAD`).
 */
export async function getDiff(dir: string, mode: DiffMode, base?: string): Promise<DiffResult> {
  let text: string;
  if (mode === "branch") {
    if (!base) throw new IpcFailure("no-base", "Pick a base branch to compare against");
    const out = await git(dir, ["diff", "--no-color", "--no-ext-diff", `${base}...HEAD`]);
    if (out.code !== 0)
      throw new IpcFailure("git-failed", out.stderr.trim().split("\n")[0] ?? "git diff failed");
    text = out.stdout;
  } else {
    const args =
      mode === "staged"
        ? ["diff", "--no-color", "--no-ext-diff", "--cached"]
        : ["diff", "--no-color", "--no-ext-diff", "HEAD"];
    const out = await git(dir, args);
    if (out.code !== 0) {
      // A repo without commits has no HEAD; its changes are all new files.
      text = "";
    } else {
      text = out.stdout;
    }
  }
  const files = parseUnifiedDiff(text);
  if (mode === "working") {
    const status = await readStatus(dir);
    if (status.ok) {
      for (const f of status.status.files) {
        if (f.kind !== "untracked" || f.path.endsWith("/")) continue;
        try {
          const full = join(dir, f.path);
          if (statSync(full).size > MAX_UNTRACKED_BYTES) continue;
          const content = readFileSync(full, "utf8");
          if (content.includes("\u0000")) continue;
          files.push(...parseUnifiedDiff(untrackedAsDiff(f.path, content)));
        } catch {
          /* unreadable files are left out of the review */
        }
      }
    }
  }
  return { files };
}
