import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AskResult } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import { IpcFailure } from "../../core/ipc";
import { stripFrontmatter } from "../notes/notes";
import type { RunService } from "../runs/service";
import { readRulePack, ruleReferences } from "../vault/rule-pack";

export const ASK_SUFFIX =
  "Answer from this vault. Follow Common/AGENTS.md: grep frontmatter first, read at most two files, cite the files you used.";

/** The prompt for one question: the question, the standing rule, and the scope when one project is chosen. */
export function buildAskPrompt(question: string, scopeFolder?: string, root?: string): string {
  const scope = scopeFolder
    ? `\n\nScope: look only in the "${scopeFolder}" folder of the vault.`
    : "";
  const rules = root ? readRulePack(root) : null;
  const guidance = rules && root
    ? `Answer from this brain and cite the files you used. ${ruleReferences(rules, root)}`
    : ASK_SUFFIX;
  return `${question.trim()}\n\n${guidance}${scope}`;
}

/** Vault-relative `.md` paths mentioned as [[wikilinks]] or plain paths, kept only when the file exists. */
export function extractCitations(text: string, root: string): string[] {
  const found: string[] = [];
  const add = (raw: string): void => {
    const clean = raw
      .trim()
      .replace(/^[./\\]+/, "")
      .replace(/\\/g, "/");
    const withExt = clean.toLowerCase().endsWith(".md") ? clean : `${clean}.md`;
    if (found.includes(withExt)) return;
    const full = resolve(root, withExt);
    if (full.startsWith(resolve(root) + sep) && existsSync(full) && statSync(full).isFile())
      found.push(withExt);
  };
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) if (m[1]) add(m[1]);
  for (const m of text.matchAll(/[\w./\\-]+\.md\b/gi)) add(m[0]);
  return found;
}

/** Reads a vault note for the citation viewer. The path must stay inside the vault and end in .md. */
export function readVaultFile(root: string, path: string): { path: string; markdown: string } {
  if (!root) throw new IpcFailure("no-vault", "No workspace folder is set up");
  const full = resolve(root, path);
  const rel = relative(resolve(root), full);
  if (
    isAbsolute(path) ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    !full.toLowerCase().endsWith(".md")
  ) {
    throw new IpcFailure("bad-path", "That is not a note inside the vault");
  }
  if (!existsSync(full)) throw new IpcFailure("not-found", `${path} does not exist`);
  return { path: rel.replace(/\\/g, "/"), markdown: stripFrontmatter(readFileSync(full, "utf8")) };
}

interface Pending {
  question: string;
  result?: AskResult;
}

/** Runs "Ask the brain" questions with the researcher role, in the workspace folder. */
export class AskService {
  private readonly asks = new Map<string, Pending>();

  constructor(
    private readonly deps: {
      runs: RunService;
      workspace: () => Workspace | null;
      workspaceRoot: () => string;
    },
  ) {}

  start(question: string, projectId?: string): string {
    const ws = this.deps.workspace();
    const root = this.deps.workspaceRoot();
    if (!ws || !root) throw new IpcFailure("no-workspace", "Set up a workspace first");
    const role = ws.roles["researcher"];
    if (!role) throw new IpcFailure("no-role", 'The workspace has no "researcher" role');
    const project = projectId ? ws.projects.find((p) => p.id === projectId) : undefined;
    if (projectId && !project) throw new IpcFailure("not-found", `No project with id ${projectId}`);
    const scopeFolder = project?.vault && project.vault !== "." ? project.vault : undefined;
    const handle = this.deps.runs.start({
      kind: "ask",
      providerId: role.provider,
      role,
      cwd: join(root),
      prompt: buildAskPrompt(question, scopeFolder, root),
      ...(projectId ? { projectId } : {}),
    });
    const pending: Pending = { question };
    this.asks.set(handle.id, pending);
    void handle.result.then((done) => {
      pending.result = {
        done: true,
        ok: done.ok,
        text: done.resultText,
        citations: extractCitations(done.resultText, root),
        ...(done.error ? { error: done.error } : {}),
      };
    });
    return handle.id;
  }

  result(runId: string): AskResult {
    return this.asks.get(runId)?.result ?? { done: false, ok: false, text: "", citations: [] };
  }

  cancel(runId: string): void {
    this.deps.runs.cancel(runId);
  }
}
