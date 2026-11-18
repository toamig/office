import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEntry } from "../../../shared/models";
import { readHub } from "./hub";

/** Open entries under "## Currently open" in a content audit file; "Nothing." means none. */
export function parseAuditEntries(markdown: string): string[] {
  const lines = markdown.split("\n").map((l) => l.replace(/\r$/, ""));
  const start = lines.findIndex((l) => /^##\s+Currently open\s*$/i.test(l));
  if (start < 0) return [];
  const entries: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const text = line.trim();
    if (!text || /^nothing\.?$/i.test(text)) continue;
    if (/^(-|###)\s/.test(text) || entries.length === 0)
      entries.push(text.replace(/^(-|###)\s+/, ""));
    else entries[entries.length - 1] += ` ${text}`;
  }
  return entries;
}

/** Open content-audit entries for the hub and every nested repo that has an audit file. */
export function readAudit(root: string): AuditEntry[] {
  if (!root) return [];
  const folders = [".", ...readHub(root).map((r) => r.folder)];
  const out: AuditEntry[] = [];
  for (const folder of folders) {
    const file = join(root, folder, "_ContentAudit.md");
    if (!existsSync(file)) continue;
    const entries = parseAuditEntries(readFileSync(file, "utf8"));
    if (entries.length > 0) out.push({ repo: folder === "." ? "hub" : folder, entries });
  }
  return out;
}
