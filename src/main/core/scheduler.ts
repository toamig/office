import { randomUUID } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Cron } from "croner";
import { applyAutonomy, effectiveAutonomy, type AutonomyLevel } from "../../shared/autonomy";
import { nextRuns, validCron } from "../../shared/schedule";
import { WorkflowRunStatus, workflowsFor, type Workflow, type WorkflowItem, type WorkflowView } from "../../shared/workflow";
import type { Role, Workspace } from "../../shared/types";
import type { HealthView } from "../../shared/models";
import type { Db } from "./db";
import type { Notifier } from "./notifier";
import type { RunRequest, RunService } from "../modules/runs/service";
import { git } from "../modules/git/run";
import { claudePath } from "../modules/providers/claude-code";
import { brainScope, notesPath, type BrainScope } from "../modules/vault/scope";
import { parseWorkflowItems, workflowItemProjects, WORKFLOW_ITEM_FORMAT } from "../modules/runs/workflow-items";

export interface WorkflowOutputRun {
  id: string;
  text: string;
  items?: WorkflowItem[] | null;
}

export interface SchedulerDeps {
  db: Db;
  runs: RunService;
  notifier: Notifier;
  workspace: () => Workspace | null;
  root: () => string;
  neutralFolder: () => string;
  projectPath: (projectId: string) => string | undefined;
  defaultProvider: () => string;
  output: (root: string, workflow: Workflow, run: WorkflowOutputRun) => Promise<void>;
  changed?: () => void;
  validate?: (root: string) => Promise<HealthView["validate"]>;
  now?: () => Date;
  fullAutoConfirmed?: () => boolean;
  /** The Claude Code tasks that are on, to warn when one runs the same thing. */
  /** The tokens a run reported using. */
  tokensOf?: (runId: string) => number;
  claudeTasks?: () => Array<{ id: string; name: string; enabled: boolean | null }>;
}

function nextRunOf(pattern: string, from: Date): Date | null {
  try {
    return new Cron(pattern, { paused: true }).nextRun(from);
  } catch {
    return null;
  }
}

export { validCron };

export const cheapestModel = (provider: string): string =>
  provider === "codex" ? "gpt-5.4-mini" : "haiku";

function historicalResult(path: string | null): string | null {
  if (!path) return null;
  try {
    const file = openSync(path, "r");
    try {
      const preview = Buffer.alloc(4096);
      return preview.subarray(0, readSync(file, preview)).toString("utf8").trim() || null;
    } finally {
      closeSync(file);
    }
  } catch {
    return null;
  }
}

const slash = (path: string): string => path.replaceAll("\\", "/");
const GIT_READS = ["status", "diff", "log"];
const GIT_WRITES = ["add", "commit"];
const WRITE_TOOLS = "Read,Grep,Glob,Edit,Write,Bash";

/** The model a workflow that writes uses: the one it names, else a capable default, never the cheapest. */
export const writingModel = (provider: string): string | undefined => provider === "codex" ? undefined : "sonnet";

/** What a workflow that writes in the Brain may run: git in the folders it may edit, and the Brain's own checks. */
export function brainCommands(root: string, folders: string[]): string[] {
  const tool = `${slash(root)}/Common/tools/brain.mjs`;
  return [
    ...folders.slice(0, 40).flatMap((dir) => [...GIT_READS, ...GIT_WRITES].map((verb) => `Bash(git -C ${slash(dir)} ${verb}:*)`)),
    "Bash(node Common/tools/brain.mjs:*)", `Bash(node ${tool}:*)`,
  ];
}

function writingBrainRequest(workflow: Workflow, ws: Workspace | null, root: string, provider: string, projectRoot: string | undefined): Pick<RunRequest, "brain" | "role" | "tools" | "addDirs"> {
  const base = brainScope(ws, root, workflow.projectId ?? undefined)!;
  const own = base.writable.length > 0;
  const writable = own ? base.writable : base.readOnly;
  const scope: BrainScope = {
    ...base, writable, readOnly: own ? base.readOnly : [], private: [...base.private, join(root, ".git")],
    restrictedRead: true,
    instructions: `${base.instructions}

This workflow may write notes in: ${writable.map(slash).join(", ")}. `
      + "Follow the Brain rules. After writing, run `node Common/tools/brain.mjs validate` from the Brain root, then commit each changed file in the folder that owns it with "
      + "`git -C <folder> add <file>` and `git -C <folder> commit -m <message>`, writing the folder exactly as listed, without quotes. Never push, reset or rewrite history.",
  };
  const role: Role = {
    provider, instructions: "", readOnly: false, codexSandbox: "workspace-write",
    ...(workflow.model || writingModel(provider) ? { model: workflow.model || writingModel(provider)! } : {}),
    allowedCommands: [...writable.map((dir) => `Edit(${claudePath(dir)}/**)`), ...brainCommands(root, writable)],
  };
  const reachesProject = projectRoot && (workflow.read === "project" || workflow.read === "both");
  return {
    brain: scope, role, tools: `${WRITE_TOOLS}${workflow.web ? ",WebSearch,WebFetch" : ""}`,
    ...(reachesProject ? { addDirs: [projectRoot] } : {}),
  };
}

function workingRole(workflow: Workflow, provider: string, project: string, confirmed: boolean): Role {
  const wanted: AutonomyLevel = workflow.autonomy === "full-auto" ? "full-auto" : "act-on-risk";
  const level = effectiveAutonomy(wanted, confirmed);
  const model = workflow.model || writingModel(provider);
  const role = applyAutonomy({ provider, instructions: "", readOnly: false, allowedCommands: [], ...(model ? { model } : {}) }, level);
  return {
    ...role,
    allowedCommands: [...role.allowedCommands, `Edit(${claudePath(project)}/**)`],
    ...(workflow.web ? {} : level === "full-auto" ? { deniedCommands: ["WebSearch", "WebFetch"] } : {}),
  };
}

export interface WorkflowRequestOptions {
  /** Whether the owner confirmed Full auto once; without it a Full auto workflow works at the default level. */
  fullAutoConfirmed?: boolean;
}

/** Resolves the working directory and read scope before asking the agent to run. */
export function workflowRequest(
  workflow: Workflow,
  ws: Workspace | null,
  root: string,
  project: string | undefined,
  neutralFolder: string,
  provider: string,
  projects = workflowItemProjects(ws, root, workflow.projectId),
  options: WorkflowRequestOptions = {},
): RunRequest {
  if (workflow.projectId && !project) throw new Error("The workflow project is unavailable on this machine.");
  const canReadProject = workflow.read === "project" || workflow.read === "both";
  const canReadBrain = workflow.read === "brain" || workflow.read === "both";
  if (canReadProject && !project) throw new Error("Choose a project for this workflow's read scope.");
  if (canReadBrain && (!root || ws?.vault.kind === "none")) throw new Error("The workflow has no Brain to read.");
  const output = workflow.output === "worth-a-look"
    ? `${WORKFLOW_ITEM_FORMAT}
Available projects: ${JSON.stringify(projects.map(({ id, name }) => ({ id, name })))}`
    : "Return the result as concise Markdown.";
  const common = {
    kind: "workflow" as const, title: workflow.name, providerId: provider, workflowId: workflow.id,
    ...(workflow.template === "brain-upkeep" ? { usageKind: "upkeep" as const } : {}), prompt: `${workflow.prompt}

${output}`,
    ...(workflow.projectId ? { projectId: workflow.projectId } : {}),
  };
  if (workflow.mayDo === "brain") {
    if (!root || ws?.vault.kind === "none" || !brainScope(ws, root, workflow.projectId ?? undefined))
      throw new Error("The workflow has no Brain to write in.");
    return { ...common, cwd: root, ...writingBrainRequest(workflow, ws, root, provider, project) };
  }
  if (workflow.mayDo === "project") {
    if (!project) throw new Error("Choose a project for a workflow that works in its project.");
    const role = workingRole(workflow, provider, project, options.fullAutoConfirmed === true);
    const full = role.autonomy === "full-auto";
    return {
      ...common, cwd: project, role,
      ...(full ? {} : { tools: `${WRITE_TOOLS}${workflow.web ? ",WebSearch,WebFetch" : ""}` }),
      ...(canReadBrain && root ? { addDirs: [root], brain: { ...(brainScope(ws, root, workflow.projectId ?? undefined) ?? { root, instructions: "", writable: [], readOnly: [], private: [] }), writable: [], restrictedRead: false } } : {}),
    };
  }
  const cwd = canReadProject ? project! : canReadBrain ? root : neutralFolder;
  const brain: BrainScope | undefined = canReadBrain ? brainScope(ws, root, workflow.projectId ?? undefined) : undefined;
  const readScope: BrainScope | undefined = brain ? {
    ...brain,
    writable: [],
    readOnly: [...brain.readOnly, ...brain.writable],
    private: [...brain.private, join(root, ".git")],
    restrictedRead: true,
    instructions: "Use the Brain routers and read only the notes that answer this workflow. Private notes are available only to their own project. Use file tools to read.",
  } : canReadProject ? {
    root: cwd, writable: [], readOnly: [], private: root && root !== cwd ? [root] : [],
    instructions: "Read only files in this project.", restrictedRead: true,
  } : undefined;
  const web = workflow.web && workflow.template !== "brain-upkeep" ? ",WebSearch,WebFetch" : "";
  return {
    ...common,
    cwd,
    tools: workflow.read === "none" ? (web ? web.slice(1) : "") : `Read,Grep,Glob${web}`,
    role: { provider, model: workflow.model || cheapestModel(provider), instructions: "", readOnly: true, allowedCommands: [] },
    ...(readScope ? { brain: readScope } : {}),
    ...(canReadBrain && canReadProject ? { addDirs: [root] } : {}),
  };
}

async function headOf(folder: string): Promise<string | null> {
  const result = await git(folder, ["rev-parse", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** The commits a workflow made in the folders it may write in, as "folder: abbreviated id subject". */
export async function commitsMade(folders: string[], before: Map<string, string | null>): Promise<string[]> {
  const lines: string[] = [];
  for (const folder of folders) {
    const from = before.get(folder);
    const after = await headOf(folder);
    if (!after || after === from) continue;
    const log = await git(folder, ["log", "--format=%h %s", ...(from ? [`${from}..HEAD`] : ["-5"])]);
    for (const line of log.stdout.split(/\r?\n/).filter(Boolean).slice(0, 20)) lines.push(`${folder.split(/[\\/]/).pop()}: ${line}`);
  }
  return lines;
}

/** A run more than this long after its slot was missed because Office was closed. */
const LATE_AFTER_MS = 120_000;

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: SchedulerDeps) {
    deps.db.prepare("UPDATE automations_log SET status = 'failed', result = 'Interrupted' WHERE status = 'running'").run();
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private lastMark(root: string, id: string): string | null {
    const row = this.deps.db.prepare(`SELECT MAX(fired_at) AS at FROM automations_log
      WHERE workspace = ? AND automation = ?`)
      .get(root, id) as { at: string | null };
    return row.at;
  }

  private mark(root: string, id: string, at: Date, status?: "running", lateFor?: Date): string {
    const key = randomUUID();
    this.deps.db.prepare("INSERT INTO automations_log (id, automation, fired_at, workspace, status, late_for) VALUES (?, ?, ?, ?, ?, ?)")
      .run(key, id, at.toISOString(), root, status ?? null, lateFor?.toISOString() ?? null);
    return key;
  }

  private latestRun(root: string, id: string): Pick<WorkflowView, "lastRun" | "lastFiredAt"> {
    const row = this.deps.db.prepare(`SELECT l.fired_at AS at, l.status, l.result,
      l.late_for AS lateFor, l.run_id AS runId, r.status AS agentStatus, r.error, r.output_path AS outputPath
      FROM automations_log l LEFT JOIN runs r ON r.id = l.run_id
      WHERE l.workspace = ? AND l.automation = ? AND (l.status IS NOT NULL OR l.run_id IS NOT NULL)
      ORDER BY l.fired_at DESC, l.rowid DESC LIMIT 1`).get(root, id) as {
        at: string; status: string | null; result: string | null; agentStatus: string | null; lateFor: string | null; runId: string | null;
        error: string | null; outputPath: string | null;
      } | undefined;
    if (!row) return { lastFiredAt: null, lastRun: null };
    const status = WorkflowRunStatus.safeParse(row.status ?? row.agentStatus);
    return {
      lastFiredAt: row.at,
      lastRun: status.success ? {
        status: status.data, result: row.result ?? row.error ?? (row.status === null ? historicalResult(row.outputPath) : null),
        lateFor: row.lateFor,
        tokens: row.runId ? this.deps.tokensOf?.(row.runId) || null : null,
      } : null,
    };
  }

  list(): WorkflowView[] {
    const root = this.deps.root();
    const claude = this.deps.claudeTasks?.() ?? [];
    return workflowsFor(this.deps.workspace()).map((workflow) => ({
      ...workflow,
      valid: workflow.schedule === null || validCron(workflow.schedule),
      ...this.latestRun(root, workflow.id),
      nextRun: workflow.enabled && workflow.schedule ? nextRunOf(workflow.schedule, this.now())?.toISOString() ?? null : null,
      alsoRunsIn: workflow.enabled && workflow.schedule && workflow.fromClaudeTask
        ? claude.find((task) => task.id === workflow.fromClaudeTask && task.enabled === true)?.name ?? null : null,
      upcoming: workflow.schedule ? nextRuns(workflow.schedule, 3, this.now()).map((at) => at.toISOString()) : [],
    }));
  }

  tick(): void {
    const root = this.deps.root();
    if (!root) return;
    const now = this.now();
    for (const workflow of workflowsFor(this.deps.workspace())) {
      if (!workflow.schedule || this.inFlight.has(`${root}\0${workflow.id}`)) continue;
      const last = this.lastMark(root, workflow.id);
      if (!last) {
        this.mark(root, workflow.id, now);
        continue;
      }
      const due = nextRunOf(workflow.schedule, new Date(last));
      if (!due || due > now) continue;
      if (workflow.enabled) void this.fire(workflow.id, now, now.getTime() - due.getTime() > LATE_AFTER_MS ? due : undefined).catch(() => undefined);
      else this.mark(root, workflow.id, now);
    }
  }

  async fire(id: string, at = this.now(), lateFor?: Date): Promise<string | null> {
    const root = this.deps.root();
    const ws = this.deps.workspace();
    const workflow = workflowsFor(ws).find((entry) => entry.id === id);
    if (!workflow) throw new Error("That workflow no longer exists.");
    if (!workflow.enabled) throw new Error("Enable this workflow before running it.");
    const key = `${root}\0${id}`;
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);
    let logId: string | undefined;
    try {
      logId = this.mark(root, id, at, "running", lateFor);
      this.deps.changed?.();
      const project = workflow.projectId ? this.deps.projectPath(workflow.projectId) : undefined;
      const projects = workflowItemProjects(ws, root, workflow.projectId);
      const request = workflowRequest(workflow, ws, root, project, this.deps.neutralFolder(),
        workflow.provider || this.deps.defaultProvider(), projects, { fullAutoConfirmed: this.deps.fullAutoConfirmed?.() === true });
      if (workflow.template === "brain-upkeep" && request.brain?.root === root)
        await this.addValidationWarnings(root, request);
      if (this.deps.root() !== root) throw new Error("The Brain changed before the workflow could start.");
      const written = request.role?.readOnly === false ? (request.brain?.writable ?? []) : [];
      const before = new Map(await Promise.all(written.map(async (folder): Promise<[string, string | null]> => [folder, await headOf(folder)])));
      const handle = this.deps.runs.start(request);
      this.deps.db.prepare("UPDATE automations_log SET run_id = ? WHERE id = ?").run(handle.id, logId);
      const result = await handle.result;
      if (result.error === "cancelled") {
        this.finish(logId, "cancelled", result.resultText);
        return handle.id;
      }
      if (!result.ok) throw new Error(result.error ?? "The agent run failed.");
      const output: WorkflowOutputRun = { id: handle.id, text: result.resultText };
      if (workflow.output === "worth-a-look" && this.deps.root() === root) {
        const stopped = await this.collectItems(output, request, new Set(projects.map((entry) => entry.id)));
        if (stopped) {
          this.finish(logId, "cancelled", stopped.text || output.text);
          return stopped.id;
        }
      }
      const commits = written.length ? await commitsMade(written, before) : [];
      if (commits.length && !output.items) output.text = `${output.text.trim()}\n\nCommits made\n${commits.map((line) => `- ${line}`).join("\n")}`;
      if (this.deps.root() === root) await this.deps.output(root, workflow, output);
      const summary = [
        output.items ? output.items.map((item) => item.title).join("\n") || "No items suggested." : output.text,
        ...(commits.length && output.items ? ["", "Commits made", ...commits.map((line) => `- ${line}`)] : []),
      ].join("\n");
      this.finish(logId, "done", summary);
      return handle.id;
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      if (logId) this.finish(logId, "failed", description);
      this.deps.notifier.notify({
        kind: "automation.done",
        ...(workflow.projectId ? { projectId: workflow.projectId } : {}),
        title: `${workflow.name} could not run`,
        body: description,
        link: { view: "workflows" },
      });
      throw error;
    } finally {
      this.inFlight.delete(key);
      this.deps.changed?.();
    }
  }

  private async addValidationWarnings(root: string, request: RunRequest): Promise<void> {
    const result = await this.deps.validate?.(root);
    const hidden = (request.brain?.private ?? []).map((path) => resolve(path).toLowerCase());
    const warnings = (result?.problems ?? []).flatMap((problem) => {
      if (problem.level !== "warning" || !problem.file || !/\b(?:lines?|ceiling|split|size)\b/i.test(problem.message)) return [];
      const path = notesPath(root, problem.file)?.toLowerCase();
      if (!path || hidden.some((folder) => path === folder || path.startsWith(folder + sep))) return [];
      return problem.message.slice(0, 400);
    }).slice(0, 30);
    const summary = warnings.length ? warnings.join("\n")
      : result?.ran ? "No size warnings in the readable notes." : "Validation was unavailable.";
    request.prompt += `\n\nBrain validation size warnings\n${summary}`;
  }

  private async collectItems(output: WorkflowOutputRun, request: RunRequest, projects: ReadonlySet<string>): Promise<{ id: string; text: string } | undefined> {
    output.items = parseWorkflowItems(output.text, projects);
    if (output.items !== null) return;
    try {
      const retry = await this.deps.runs.start({
        ...request,
        prompt: `${request.prompt}\n\nThe first response did not match the required shape. Check the JSON, required fields and project IDs before replying.`,
      }).result;
      if (retry.error === "cancelled") return { id: retry.id, text: retry.resultText };
      if (retry.ok) {
        output.text = retry.resultText.trim() ? retry.resultText : output.text;
        output.items = parseWorkflowItems(retry.resultText, projects);
      }
    } catch {
      // The first reply is still available as a plain item.
    }
  }

  private finish(id: string, status: "done" | "failed" | "cancelled", result: string): void {
    const text = result.trim();
    const preview = text.length > 2400 ? `${text.slice(0, 2399)}…` : text;
    this.deps.db.prepare("UPDATE automations_log SET status = ?, result = ? WHERE id = ?")
      .run(status, preview || null, id);
  }

  start(): void {
    this.stop();
    const root = this.deps.root();
    if (root) this.deps.db.prepare("UPDATE automations_log SET workspace = ? WHERE workspace = ''").run(root);
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
