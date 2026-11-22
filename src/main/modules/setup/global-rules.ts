import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PendingItem } from "../../../shared/models";
import { userHome } from "../../core/paths";
import { writeRawFile, writeTextFile } from "../../core/settings";
import { installPointer, POINTER_BEGIN, POINTER_END, removePointer } from "../onboarding/pointer";
import { readRulePack, ruleBody, ruleReferences } from "../vault/rule-pack";
import { unifiedDiff } from "./install-hooks";

export const GLOBAL_RULE_FILES = [
  { id: "claude-code", label: "Claude Code", path: ".claude/CLAUDE.md" },
  { id: "codex", label: "Codex", path: ".codex/AGENTS.md" },
] as const;
type Tool = typeof GLOBAL_RULE_FILES[number]["id"];
type Installed = { block: string; root: string; created: boolean; ignored?: string };
type State = { tools: Partial<Record<Tool, Installed>>; undo?: Partial<Record<Tool, Installed>> };
type Edit = { tool: Tool; label: string; file: string; before: string | null; after: string | null };
type Preview = { id: string; root: string; edits: Edit[]; remove: boolean };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function readFile(path: string): string | null {
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile()) throw new Error(`${path} must be a regular file.`);
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${path} is not valid UTF-8.`);
  return text;
}

function region(text: string) {
  const start = text.indexOf(POINTER_BEGIN);
  const end = text.indexOf(POINTER_END);
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < start || start !== text.lastIndexOf(POINTER_BEGIN) || end !== text.lastIndexOf(POINTER_END))
    throw new Error("The Office markers are incomplete or repeated.");
  const newline = text.indexOf("\n", end);
  const length = newline < 0 ? text.length : newline + 1;
  return { start, end: length, text: text.slice(start, length) };
}

function replaceBlock(original: string | null, block: string): string {
  const target = region(original ?? "");
  if (!target || original === null) return installPointer(original, block);
  const beginLine = target.text.split("\n", 1)[0]!.replace(/\r$/, "");
  return original.slice(0, target.start) + block.replace(POINTER_BEGIN, () => beginLine) + original.slice(target.end);
}

function marker(root: string): string {
  return `Brain folder: ${resolve(root).replaceAll("\\", "/")}`;
}

export function globalRulesBlock(root: string): string | null {
  const pack = readRulePack(root);
  if (!pack) return null;
  const parts = pack.load.flatMap((entry) => {
    if (entry.where === "project") return [];
    const body = ruleBody(root, entry.file);
    return body ? [`### ${entry.domain ? `Only in ${entry.domain} projects` : entry.file}\n\n${body}`] : [];
  });
  return [POINTER_BEGIN, "## Office Brain rules", marker(root), ruleReferences(pack, root),
    ...parts, POINTER_END, ""].join("\n\n").replace(/\n\n$/, "\n");
}

export function availableGlobalRules(root: string, provider: string): string {
  const tool = GLOBAL_RULE_FILES.find((entry) => entry.id === provider);
  if (!tool || !root) return "";
  try {
    const block = region(readFile(join(userHome(), tool.path)) ?? "")?.text ?? "";
    return block.split(/\r?\n/).includes(marker(root)) ? block.replaceAll("\r\n", "\n") : "";
  } catch { return ""; }
}

export class GlobalRules {
  private plan?: Preview;

  constructor(private readonly root: () => string, private readonly home: () => string, private readonly stateFile: string) {}

  private state(): State {
    try { return JSON.parse(readFileSync(this.stateFile, "utf8")) as State; }
    catch { return { tools: {} }; }
  }

  private save(state: State): void {
    writeTextFile(this.stateFile, JSON.stringify(state) + "\n");
  }

  status() {
    const state = this.state();
    const root = this.root();
    return {
      available: !!readRulePack(root),
      tools: GLOBAL_RULE_FILES.map((tool) => {
        const record = state.tools[tool.id];
        try {
          const block = region(readFile(join(this.home(), tool.path)) ?? "")?.text;
          const installed = Boolean(block);
          const conflict = !!record && block !== record.block;
          return { id: tool.id, label: tool.label, installed, conflict };
        } catch {
          return { id: tool.id, label: tool.label, installed: false, conflict: true };
        }
      }),
      undo: Object.keys(state.undo ?? {}).length > 0,
    };
  }

  preview(remove = false) {
    const root = this.root();
    const block = remove ? null : globalRulesBlock(root);
    if (!remove && !block) throw new Error("Add a Brain rule pack first.");
    const state = this.state();
    const edits = GLOBAL_RULE_FILES.flatMap((tool): Edit[] => {
      const file = join(this.home(), tool.path);
      const before = readFile(file);
      const current = region(before ?? "");
      if (remove && !current) return [];
      const restored = remove ? removePointer(before ?? "") : replaceBlock(before, block!);
      const after = remove && restored === "" && state.tools[tool.id]?.created ? null : restored;
      return before === after ? [] : [{ tool: tool.id, label: tool.label, file, before, after }];
    });
    const id = randomUUID();
    this.plan = { id, root, edits, remove };
    return { id, changes: edits.map(({ label, file, before, after }) => ({
      label, file, diff: unifiedDiff((before ?? "").slice(0, 40_000), (after ?? "").slice(0, 40_000)),
    })) };
  }

  apply(id: string): void {
    const plan = this.plan;
    if (!plan || plan.id !== id || plan.root !== this.root()) throw new Error("Review the instructions again.");
    const state = this.state();
    for (const { file, before } of plan.edits)
      if (readFile(file) !== before) throw new Error("An instructions file changed. Review the diff again.");
    for (const edit of plan.edits) {
      if (edit.before !== null) writeRawFile(join(this.stateFile + ".backups", `${edit.tool}-${id}.md`), edit.before);
      if (edit.after === null) rmSync(edit.file, { force: true });
      else writeRawFile(edit.file, edit.after);
      if (plan.remove) delete state.tools[edit.tool];
      else state.tools[edit.tool] = {
        block: region(edit.after!)!.text, root: plan.root, created: state.tools[edit.tool]?.created ?? edit.before === null,
      };
    }
    delete state.undo;
    this.save(state);
    this.plan = undefined;
  }

  refresh(): string[] {
    const root = this.root();
    const desired = globalRulesBlock(root);
    if (!desired) return [];
    const state = this.state();
    const changed: string[] = [];
    const undo: Partial<Record<Tool, Installed>> = {};
    for (const tool of GLOBAL_RULE_FILES) {
      const record = state.tools[tool.id];
      if (!record || record.root !== root) continue;
      const file = join(this.home(), tool.path);
      const before = readFile(file);
      if (before === null || region(before)?.text !== record.block) continue;
      const after = replaceBlock(before, desired);
      if (after === before) continue;
      const block = region(after)!.text;
      if (record.ignored === sha(block)) continue;
      writeRawFile(file, after);
      undo[tool.id] = record;
      state.tools[tool.id] = { ...record, block, ignored: undefined };
      changed.push(tool.label);
    }
    if (changed.length) this.save({ ...state, undo });
    return changed;
  }

  undo(): void {
    const state = this.state();
    const edits = GLOBAL_RULE_FILES.flatMap((tool): Array<{ file: string; text: string; tool: Tool; record: Installed }> => {
      const earlier = state.undo?.[tool.id];
      if (!earlier || earlier.root !== this.root()) return [];
      const file = join(this.home(), tool.path);
      const text = readFile(file);
      const current = text !== null && region(text);
      if (!current || current.text !== state.tools[tool.id]?.block)
        throw new Error(`${tool.label} instructions changed after the update.`);
      return [{ tool: tool.id, file, text: text!.slice(0, current.start) + earlier.block + text!.slice(current.end), record: earlier }];
    });
    for (const edit of edits) {
      writeRawFile(edit.file, edit.text);
      state.tools[edit.tool] = { ...edit.record, ignored: sha(state.tools[edit.tool]!.block) };
    }
    delete state.undo;
    this.save(state);
  }

  pending(): PendingItem[] {
    return this.status().tools.filter((tool) => tool.conflict).map((tool) => ({
      key: `global-rules:${tool.id}`, kind: "rule-update", severity: "attention", projectId: null,
      title: "Agent instructions changed", detail: tool.label,
      link: { view: "setup", params: { instructions: tool.id } },
      fingerprint: sha(globalRulesBlock(this.root()) ?? tool.id),
    }));
  }
}
