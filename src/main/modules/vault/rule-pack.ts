import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { run, type RunResult } from "../../core/exec";
import { stripFrontmatter } from "../notes/notes";

const pathInBrain = z.string().min(1).refine((path) =>
  !/^[\\/]|[:\0]/.test(path) && !path.split(/[\\/]/).includes(".."), "Use a path inside the brain");
const command = z.string().trim().min(1).refine((text) => !/[\r\n\0]/.test(text));
const Tool = z.enum(["validate", "reindex", "reindexCheck", "sync"]);
export type RuleTool = z.infer<typeof Tool>;

export const RulePack = z.object({
  name: z.string().trim().min(1),
  source: z.string().regex(/^(?:own|office-starter@[1-9]\d*)$/),
  read: pathInBrain,
  write: pathInBrain,
  placement: z.string().min(1).refine((ref) => pathInBrain.safeParse(ref.split("#", 1)[0]).success),
  templates: pathInBrain,
  load: z.array(z.object({
    file: pathInBrain, domain: z.string().trim().min(1).optional(), where: z.enum(["global", "project"]).optional(),
  })).default([]),
  tools: z.partialRecord(Tool, command).default({}),
  checks: z.object({
    staged: z.array(z.enum(["utf8-no-bom", "lf", "no-dash-in-added-prose"])).default([]),
    commitMsg: z.array(z.literal("strip-co-authored-by")).default([]),
  }).default({ staged: [], commitMsg: [] }),
  domains: z.array(z.string().trim().min(1)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});
export type RulePack = z.infer<typeof RulePack>;

export function brainPath(root: string, path: string): string | null {
  if (!root || !pathInBrain.safeParse(path).success || isAbsolute(path)) return null;
  const base = resolve(root);
  const target = resolve(base, ...path.split(/[\\/]/));
  const rel = relative(base, target);
  if (!rel || isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === "..") return null;
  let current = base;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      break;
    }
  }
  return target;
}

export function brainText(path: string | null): string {
  if (!path) return "";
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

export function readRulePack(root: string): RulePack | null {
  for (const folder of ["Common", "Rules"]) {
    const text = brainText(brainPath(root, `${folder}/rules.json`));
    if (!text) continue;
    try { return RulePack.parse(JSON.parse(text)); } catch { return null; }
  }
  return null;
}

export function ruleBody(root: string, reference: string): string {
  const [file, heading] = reference.split("#", 2);
  if (!file) return "";
  const body = stripFrontmatter(brainText(brainPath(root, file))).trim();
  if (!heading) return body;
  const headings = [...body.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)];
  const index = headings.findIndex((entry) => entry[2]?.toLowerCase() === heading.toLowerCase());
  const start = headings[index];
  if (!start) return "";
  const end = headings.slice(index + 1).find((entry) => entry[1]!.length <= start[1]!.length);
  return body.slice(start.index + start[0].length, end?.index).trim();
}

export function ruleReferences(pack: RulePack, root: string): string {
  return `First read ${join(root, pack.read)}. For writes follow ${join(root, pack.write)}, use ${join(root, pack.placement)} to choose a location, and use ${join(root, pack.templates)} for new notes.`;
}

/** Pack commands are executable and arguments, with optional quotes around paths with spaces. */
export function ruleCommand(text: string): string[] {
  const args: string[] = [];
  const token = /\s*((?:"[^"]*"|'[^']*'|[^\s"']+)+)(?=\s|$)/y;
  while (token.lastIndex < text.trimEnd().length) {
    const part = token.exec(text)?.[1];
    if (!part) throw new Error("Invalid quoting in rule pack command.");
    args.push(part.replace(/"([^"]*)"|'([^']*)'/g, (_match, double, single) => double ?? single));
  }
  return args;
}

export function runRuleTool(root: string, tool: RuleTool, timeoutMs: number, fallback?: string[]): Promise<RunResult> | undefined {
  const text = readRulePack(root)?.tools[tool];
  const [executable, ...args] = text ? ruleCommand(text) : fallback ?? [];
  return executable ? run(executable, args, { cwd: root, timeoutMs }) : undefined;
}
