import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { writeRawFile, writeTextFile } from "../../core/settings";

export const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SessionEnd",
];
export const RELAY_MARK = "office-relay.mjs";

export interface HookPaths {
  claudeSettings: string;
  codexConfig: string;
  /** Where Office remembers what it installed (hashes and backups). */
  recordPath: string;
  /** Absolute path of office-relay.mjs. */
  relayScript: string;
}

export type HookTarget = "claude" | "codex";
export type HookAction = "install" | "uninstall";

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const slashes = (p: string): string => p.replace(/\\/g, "/");

// ---------- diff ----------

/** A small line diff with two lines of context, for the consent screen. */
export function unifiedDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines: Array<{ tag: " " | "+" | "-"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push({ tag: " ", text: a[i]! });
      i++;
      j++;
    } else if (j < m && (i >= n || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      lines.push({ tag: "+", text: b[j]! });
      j++;
    } else {
      lines.push({ tag: "-", text: a[i]! });
      i++;
    }
  }
  const keep = new Set<number>();
  lines.forEach((l, index) => {
    if (l.tag === " ") return;
    for (let k = Math.max(0, index - 2); k <= Math.min(lines.length - 1, index + 2); k++)
      keep.add(k);
  });
  const out: string[] = [];
  let last = -2;
  lines.forEach((l, index) => {
    if (!keep.has(index)) return;
    if (index > last + 1 && out.length > 0) out.push("...");
    out.push(`${l.tag} ${l.text}`);
    last = index;
  });
  return out.join("\n");
}

// ---------- Claude Code: settings.json ----------

function detectIndent(text: string): string | number {
  const m = /^([ \t]+)"/m.exec(text);
  if (!m?.[1]) return 2;
  return m[1].startsWith("\t") ? "\t" : m[1].length;
}

type Hooks = Record<
  string,
  Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string }> }>
>;
type Settings = Record<string, unknown> & { hooks?: Hooks };

export const claudeCommand = (relayScript: string): string =>
  `node "${slashes(relayScript)}" claude`;

function serializeJson(value: unknown, original: string | null): string {
  const json = JSON.stringify(value, null, original ? detectIndent(original) : 2);
  const text = original && !original.endsWith("\n") ? json : `${json}\n`;
  return original?.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

/** Adds one relay entry per event, after any existing hooks. Re-running updates the path instead of duplicating. */
export function planClaudeInstall(original: string | null, relayScript: string): string {
  const settings: Settings = original ? (JSON.parse(original) as Settings) : {};
  const hooks: Hooks = (settings.hooks ??= {});
  const command = claudeCommand(relayScript);
  for (const event of CLAUDE_EVENTS) {
    const groups = (hooks[event] ??= []);
    let found = false;
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        if (hook.command?.includes(RELAY_MARK)) {
          hook.command = command;
          found = true;
        }
      }
    }
    if (!found) groups.push({ hooks: [{ type: "command", command }] });
  }
  return serializeJson(settings, original);
}

/** Removes only the entries whose command contains office-relay.mjs, and any group or key left empty. */
export function planClaudeUninstall(current: string): string {
  const settings = JSON.parse(current) as Settings;
  const hooks = settings.hooks;
  if (hooks) {
    // An empty "hooks": {} the owner already had is theirs to keep.
    const hadEntries = Object.keys(hooks).length > 0;
    for (const event of Object.keys(hooks)) {
      const groups = (hooks[event] ?? [])
        .map((g) => ({
          ...g,
          hooks: (g.hooks ?? []).filter((h) => !h.command?.includes(RELAY_MARK)),
        }))
        .filter((g) => g.hooks.length > 0);
      if (groups.length > 0) hooks[event] = groups;
      else delete hooks[event];
    }
    if (hadEntries && Object.keys(hooks).length === 0) delete settings.hooks;
  }
  return serializeJson(settings, current);
}

export function claudeInstalled(text: string | null): boolean {
  return (
    text !== null &&
    CLAUDE_EVENTS.every((e) =>
      new RegExp(`"${e}"[\\s\\S]*?${RELAY_MARK.replace(".", "\\.")}`).test(text),
    )
  );
}

// ---------- Codex: config.toml notify ----------

interface NotifyStatement {
  /** Start of the key (after any indentation). */
  start: number;
  /** Index of the `[` that opens the array. */
  open: number;
  end: number;
  array: string[];
}

const BOM = "﻿";

/** Index just past the string that starts at `i` (basic, literal, or either multi-line form). */
function skipString(text: string, i: number): number {
  const quote = text[i] as string;
  const n = text.length;
  if (text.startsWith(quote.repeat(3), i)) {
    let j = i + 3;
    while (j < n) {
      if (quote === '"' && text[j] === "\\") j += 2;
      else if (text.startsWith(quote.repeat(3), j)) {
        j += 3;
        while (text[j] === quote) j++;
        return j;
      } else j++;
    }
    return n;
  }
  let j = i + 1;
  while (j < n && text[j] !== quote && text[j] !== "\n") {
    if (quote === '"' && text[j] === "\\") j++;
    j++;
  }
  return text[j] === quote ? j + 1 : j;
}

/**
 * Walks a TOML file understanding strings, comments and brackets. Returns where the first table header
 * starts (the end of the top-level keys) and where each top-level statement starts.
 */
function scanTopLevel(text: string): { tableStart: number; statements: number[] } {
  const n = text.length;
  const statements: number[] = [];
  let depth = 0;
  let lineStart = true;
  let i = 0;
  while (i < n) {
    if (lineStart && depth === 0) {
      while (text[i] === " " || text[i] === "\t") i++;
      if (i >= n) break;
      const ch = text[i];
      if (ch === "[") return { tableStart: i, statements };
      if (ch !== "\n" && ch !== "\r" && ch !== "#") statements.push(i);
    }
    lineStart = false;
    const c = text[i];
    if (c === "\n") {
      lineStart = true;
      i++;
    } else if (c === "#") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === '"' || c === "'") i = skipString(text, i);
    else {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth = Math.max(0, depth - 1);
      i++;
    }
  }
  return { tableStart: n, statements };
}

/** The end of the bracket that opens at `open`, or -1. */
function matchBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = skipString(text, i) - 1;
    else if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Finds the top-level `notify = [...]` statement. A leading byte order mark, indentation and a quoted key
 * are all accepted; a notify inside a table does not count.
 */
export function findNotify(text: string): NotifyStatement | null {
  // The mark becomes a space so every offset stays valid for the original text.
  const flat = text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
  const { statements } = scanTopLevel(flat);
  for (const start of statements) {
    const key = /^(?:"notify"|'notify'|notify)[ \t]*=[ \t]*\[/.exec(flat.slice(start, start + 40));
    if (!key) continue;
    const open = start + key[0].length - 1;
    const end = matchBracket(flat, open);
    if (end < 0) return null;
    const parsed = parseToml(`notify = ${flat.slice(open, end)}`) as { notify?: unknown };
    const array = Array.isArray(parsed.notify) ? parsed.notify.map(String) : [];
    return { start, open, end, array };
  }
  return null;
}

const tomlArray = (items: string[]): string =>
  `[${items.map((x) => JSON.stringify(x)).join(", ")}]`;
const notifyLine = (items: string[]): string => `notify = ${tomlArray(items)}`;

export function isOfficeNotify(array: string[]): boolean {
  return array[2] === "codex" && array[3] === "--chain" && (array[1] ?? "").includes(RELAY_MARK);
}

/** Replaces only the notify statement (or adds it after the top-level keys); nothing else is re-written. */
export function planCodexInstall(original: string | null, relayScript: string): string {
  const text = original ?? "";
  const found = findNotify(text);
  const wrap = (rest: string[]): string[] => [
    "node",
    slashes(relayScript),
    "codex",
    "--chain",
    ...rest,
  ];
  if (found) {
    const rest = isOfficeNotify(found.array) ? found.array.slice(4) : found.array;
    // Only the array is replaced, so the key's own spelling, spacing and indentation stay as they were.
    return text.slice(0, found.open) + tomlArray(wrap(rest)) + text.slice(found.end);
  }
  const line = notifyLine(wrap([]));
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const bom = text.startsWith(BOM) ? BOM : "";
  const { tableStart } = scanTopLevel(bom ? ` ${text.slice(1)}` : text);
  const region = text.slice(0, tableStart);
  const lines = region.split("\n");
  let lastKey = -1;
  lines.forEach((l, index) => {
    if (l.trim() && !l.trim().startsWith("#")) lastKey = index;
  });
  if (lastKey < 0) return `${bom}${line}${eol}${text.slice(bom.length)}`;
  // Cut after the last key, without its line ending, so the new line gets the file's own ending.
  const before = lines
    .slice(0, lastKey + 1)
    .join("\n")
    .replace(/\r$/, "");
  return before + eol + line + text.slice(before.length);
}

/** Restores the original notify command from the --chain arguments; removes the line if there was none. */
export function planCodexUninstall(current: string): string {
  const found = findNotify(current);
  if (!found || !isOfficeNotify(found.array)) return current;
  const rest = found.array.slice(4);
  if (rest.length > 0)
    return current.slice(0, found.open) + tomlArray(rest) + current.slice(found.end);
  // Remove the whole line, indentation included, but never the byte order mark at the top of the file.
  const lineStart = Math.max(
    found.start > 0 ? current.lastIndexOf("\n", found.start - 1) + 1 : 0,
    current.startsWith(BOM) ? 1 : 0,
  );
  const lineEnd = current.indexOf("\n", found.end);
  const stop = lineEnd < 0 ? current.length : lineEnd + 1;
  return current.slice(0, lineStart) + current.slice(stop);
}

export function codexInstalled(text: string | null): boolean {
  const found = text ? findNotify(text) : null;
  return found !== null && isOfficeNotify(found.array);
}

// ---------- manager ----------

interface Record1 {
  /** Where the original lived: null when the file did not exist. */
  backup: string | null;
  originalSha: string | null;
  installedSha: string;
}
type InstallRecord = Partial<Record<HookTarget, Record1>>;

export interface HookStatus {
  installed: boolean;
  path: string;
  exists: boolean;
  /** The notify command Codex runs today (for the consent screen). */
  notify?: string;
}

const stamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

/** Consent-based installation of the relay into Claude Code's hooks and Codex's notify (plan 9). */
export class HooksManager {
  constructor(private readonly paths: () => HookPaths) {}

  private read(path: string): string | null {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  private record(): InstallRecord {
    const text = this.read(this.paths().recordPath);
    try {
      return text ? (JSON.parse(text) as InstallRecord) : {};
    } catch {
      return {};
    }
  }

  private saveRecord(record: InstallRecord): void {
    writeTextFile(this.paths().recordPath, `${JSON.stringify(record, null, 2)}\n`);
  }

  private fileOf(target: HookTarget): string {
    return target === "claude" ? this.paths().claudeSettings : this.paths().codexConfig;
  }

  status(): Record<HookTarget, HookStatus> {
    const claude = this.read(this.paths().claudeSettings);
    const codex = this.read(this.paths().codexConfig);
    const notify = codex ? findNotify(codex) : null;
    return {
      claude: {
        installed: claudeInstalled(claude),
        path: this.paths().claudeSettings,
        exists: claude !== null,
      },
      codex: {
        installed: codexInstalled(codex),
        path: this.paths().codexConfig,
        exists: codex !== null,
        ...(notify ? { notify: notify.array.join(" ") } : {}),
      },
    };
  }

  private plan(
    target: HookTarget,
    action: HookAction,
  ): { before: string | null; after: string | null; restoreFrom: string | null } {
    const before = this.read(this.fileOf(target));
    const script = this.paths().relayScript;
    if (action === "install") {
      const after =
        target === "claude" ? planClaudeInstall(before, script) : planCodexInstall(before, script);
      return { before, after, restoreFrom: null };
    }
    if (before === null) return { before, after: null, restoreFrom: null };
    const rec = this.record()[target];
    // Untouched since install: put the original bytes back exactly (or remove a file we created).
    if (rec && sha(before) === rec.installedSha) {
      if (rec.originalSha === null) return { before, after: null, restoreFrom: null };
      if (rec.backup && existsSync(rec.backup))
        return { before, after: readFileSync(rec.backup, "utf8"), restoreFrom: rec.backup };
    }
    return {
      before,
      after: target === "claude" ? planClaudeUninstall(before) : planCodexUninstall(before),
      restoreFrom: null,
    };
  }

  /** The exact change that would be made, as a diff, for the consent screen. */
  preview(
    target: HookTarget,
    action: HookAction,
  ): { path: string; diff: string; changed: boolean } {
    const { before, after } = this.plan(target, action);
    const path = this.fileOf(target);
    if (after === null) {
      return {
        path,
        diff: before === null ? "" : "(the file would be removed)",
        changed: before !== null,
      };
    }
    return { path, diff: unifiedDiff(before ?? "", after), changed: before !== after };
  }

  /** Applies the change after the owner agreed. Writes a timestamped backup first. */
  apply(target: HookTarget, action: HookAction): { backup: string | null } {
    const path = this.fileOf(target);
    const { before, after, restoreFrom } = this.plan(target, action);
    const record = this.record();
    if (action === "uninstall") {
      if (before === null) return { backup: null };
      let backup: string | null = null;
      if (after === null) unlinkSync(path);
      else if (restoreFrom) {
        // A byte copy, so a file that is not valid UTF-8 comes back exactly as it was.
        copyFileSync(restoreFrom, path);
      } else {
        // The file changed after install, so it is edited in place; keep what it was just before.
        backup = `${path}.office-backup-${stamp()}`;
        copyFileSync(path, backup);
        writeRawFile(path, after);
      }
      delete record[target];
      this.saveRecord(record);
      return { backup };
    }
    if (after === null) throw new Error("Nothing to install");
    const existing = record[target];
    const untouched =
      existing !== undefined && before !== null && sha(before) === existing.installedSha;
    let backup: string | null = existing?.backup ?? null;
    if (!untouched) {
      backup = null;
      if (before !== null) {
        backup = `${path}.office-backup-${stamp()}`;
        copyFileSync(path, backup);
      }
    }
    if (after !== before) writeRawFile(path, after);
    record[target] =
      untouched && existing
        ? { ...existing, installedSha: sha(after) }
        : { backup, originalSha: before === null ? null : sha(before), installedSha: sha(after) };
    this.saveRecord(record);
    return { backup };
  }
}
