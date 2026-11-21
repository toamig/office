import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BriefItem, BriefLine, BriefView } from "../../../shared/models";
import type { Project, Workspace } from "../../../shared/types";
import type { Db } from "../../core/db";
import type { Notifier } from "../../core/notifier";
import { projectFolder } from "../../core/util";
import { git } from "../git/run";
import type { RunService } from "../runs/service";
import { cheapestModel } from "../../core/scheduler";

const MARKER = "__run__";
/** The row that holds the brief's lines; the other rows of a date are the facts of one project each. */
const LINES = "__lines__";

export interface Activity {
  project: Project;
  commits: string[];
  notes: string[];
  sessions: string[];
  runs: string[];
}

export interface BriefDeps {
  db: Db;
  runs: RunService;
  notifier: Notifier;
  workspace: () => Workspace | null;
  projectsRoot: () => string;
  projectPaths?: () => Record<string, string>;
  workspaceRoot: () => string;
  now?: () => Date;
  settings?: () => { enabled: boolean; model: string; time?: string | undefined };
  defaultProvider?: () => string;
  /** Called when a brief was written, so a view showing it can read it again. */
  written?: () => void;
}

const pad = (n: number): string => String(n).padStart(2, "0");
export const localDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Midnight at the start of yesterday, local time. */
export function startOfYesterday(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - 1);
  return d;
}

/** True once today's brief time has passed. */
export function briefDue(now: Date, briefTime: string): boolean {
  const [h, m] = briefTime.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= (h ?? 0) * 60 + (m ?? 0);
}

async function subjects(repo: string, since: string, paths: string[] = []): Promise<string[]> {
  if (!existsSync(join(repo, ".git")) && !existsSync(repo)) return [];
  const result = await git(repo, [
    "log",
    `--since=${since}`,
    "--format=%s",
    "--no-merges",
    ...(paths.length ? ["--", ...paths] : []),
  ]);
  return result.code === 0 ? result.stdout.split("\n").filter(Boolean) : [];
}

/** The most lines a brief has, and the longest a line may be: it is read at a glance on Home. */
export const BRIEF_MAX_LINES = 5;
export const BRIEF_MAX_CHARS = 140;

/** The only tools the brief's run has: it reads nothing, because every fact is in the prompt. */
export const BRIEF_TOOLS = "";

/** The facts as the prompt gives them, and the format the answer must take. */
export function buildBriefPrompt(activities: Activity[], needsYou: string[] = []): string {
  const lines = [
    "Write the owner's morning brief as three to five plain lines, one per line, each starting with `- `.",
    `Each line is one short sentence of at most ${BRIEF_MAX_CHARS} characters, with no markdown, links or headings.`,
    "Cover, in this order: what changed yesterday, what needs the owner, and what is worth doing next.",
    "Use only the facts below; do not read anything else.",
    "",
  ];
  for (const a of activities) {
    lines.push(`### ${a.project.name}`);
    for (const c of a.commits) lines.push(`- commit: ${c}`);
    for (const n of a.notes) lines.push(`- brain: ${n}`);
    for (const s of a.sessions) lines.push(`- session: ${s}`);
    for (const r of a.runs) lines.push(`- run: ${r}`);
    lines.push("");
  }
  if (needsYou.length > 0) {
    lines.push("### Needs the owner now");
    for (const n of needsYou) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** The lines of the model's answer: at most five, each cut to the limit, without bullets or markdown. */
export function parseBriefLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) =>
      l
        .replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")
        .replace(/[*_`>]/g, "")
        .trim(),
    )
    .filter((l) => l.length > 0)
    .slice(0, BRIEF_MAX_LINES)
    .map((l) =>
      l.length > BRIEF_MAX_CHARS ? `${l.slice(0, BRIEF_MAX_CHARS - 3).trimEnd()}...` : l,
    );
}

/** Where a line leads: the project it names, the list of what needs you, or Home. */
export function linkForLine(
  line: string,
  projects: Array<{ id: string; name: string }>,
): BriefLine["link"] {
  const named = projects.find((p) => line.toLowerCase().includes(p.name.toLowerCase()));
  if (/need(s)? you|waiting|approv|review|conflict|failed/i.test(line)) return { view: "inbox" };
  if (named) return { view: "project", params: { id: named.id } };
  return { view: "home" };
}

/** The lines when no model could be asked: written from the facts, so the brief never comes out empty. */
export function plainBrief(activities: Activity[], needsYou: string[]): string[] {
  const out: string[] = [];
  if (activities.length > 0) {
    const names = activities.map((a) => a.project.name);
    out.push(`Changed since you last looked: ${names.join(", ")}.`);
  } else out.push("Nothing changed since you last looked.");
  out.push(
    needsYou.length > 0
      ? `${needsYou.length} ${needsYou.length === 1 ? "thing needs" : "things need"} you.`
      : "Nothing needs you.",
  );
  return out;
}

/** What a project's facts say, as bullet lines: shown under Show details. */
const factsOf = (a: Activity): string =>
  [
    ...a.commits.map((c) => `- ${c}`),
    ...a.notes.map((n) => `- brain: ${n}`),
    ...a.sessions.map((s) => `- ${s}`),
    ...a.runs.map((r) => `- ${r}`),
  ].join("\n");

/** The morning brief: what changed per project yesterday, written by a cheap model. */
export class BriefService {
  /** What waits on the owner right now (titles), set by the app so the brief can say it. */
  needsYou: () => string[] = () => [];

  constructor(private readonly deps: BriefDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** Commits, brain changes and finished sessions and runs since `since`, for each non-archived project. */
  async collect(since: Date): Promise<Activity[]> {
    const ws = this.deps.workspace();
    if (!ws) return [];
    const iso = since.toISOString();
    const out: Activity[] = [];
    for (const project of ws.projects) {
      if (project.archived) continue;
      const code = projectFolder(this.deps.projectsRoot(), project, this.deps.projectPaths?.());
      const commits = await subjects(code, iso);
      let notes: string[] = [];
      if (project.vault !== undefined && project.vault !== "." && ws.vault.kind !== "none") {
        const folder = join(this.deps.workspaceRoot(), project.vault);
        notes = existsSync(join(folder, ".git"))
          ? await subjects(folder, iso)
          : await subjects(this.deps.workspaceRoot(), iso, [project.vault]);
      }
      const sessions = (
        this.deps.db
          .prepare("SELECT title, status FROM sessions WHERE project_id = ? AND ended_at >= ?")
          .all(project.id, iso) as Array<{ title: string | null; status: string }>
      ).map(
        (s) => `${s.title ?? "an agent session"} ${s.status === "failed" ? "failed" : "finished"}`,
      );
      const runs = (
        this.deps.db
          .prepare(
            "SELECT kind, status FROM runs WHERE project_id = ? AND ended_at >= ? AND kind NOT IN ('brief', 'ask')",
          )
          .all(project.id, iso) as Array<{ kind: string; status: string }>
      ).map((r) => `${r.kind} run ${r.status}`);
      if (commits.length + notes.length + sessions.length + runs.length > 0) {
        out.push({ project, commits, notes, sessions, runs });
      }
    }
    return out;
  }

  /** Writes today's brief: a few plain lines, and the facts behind them. Returns how many projects had news. */
  async run(): Promise<{ date: string; count: number }> {
    const ws = this.deps.workspace();
    const now = this.now();
    const date = localDate(now);
    this.mark(date);
    if (!ws) return { date, count: 0 };
    const activities = await this.collect(startOfYesterday(now));
    const needsYou = this.needsYou();
    let lines: string[] = [];
    if (activities.length + needsYou.length === 0) {
      lines = ["Nothing changed since you last looked, and nothing needs you."];
    } else if (this.deps.settings?.().enabled !== false) {
      // The run may only read, with nothing allowed to run, on the cheapest model; every fact is in its prompt.
      const role = ws.roles["brief"];
      const provider = role?.provider ?? this.deps.defaultProvider?.() ?? "claude-code";
      try {
        const handle = this.deps.runs.start({
          kind: "brief",
          providerId: provider,
          role: {
            provider,
            model: this.deps.settings?.().model || cheapestModel(provider),
            instructions: "",
            readOnly: true,
            allowedCommands: [],
          },
          tools: BRIEF_TOOLS,
          cwd: this.deps.workspaceRoot() || this.deps.projectsRoot(),
          prompt: buildBriefPrompt(activities, needsYou),
        });
        const result = await handle.result;
        if (result.ok) lines = parseBriefLines(result.resultText);
      } catch {
        /* the plain lines below are used */
      }
    }
    if (lines.length === 0) lines = plainBrief(activities, needsYou);
    const projects = ws.projects;
    const stored: BriefLine[] = lines.map((text) => ({ text, link: linkForLine(text, projects) }));
    const insert = this.deps.db.prepare(
      "INSERT INTO briefs (date, project_id, markdown) VALUES (?, ?, ?) ON CONFLICT(date, project_id) DO UPDATE SET markdown = excluded.markdown",
    );
    this.deps.db.transaction(() => {
      insert.run(date, LINES, JSON.stringify(stored));
      for (const a of activities) insert.run(date, a.project.id, factsOf(a));
    })();
    this.deps.written?.();
    return { date, count: activities.length };
  }

  private mark(date: string): void {
    this.deps.db
      .prepare(
        "INSERT INTO briefs (date, project_id, markdown) VALUES (?, ?, '') ON CONFLICT(date, project_id) DO NOTHING",
      )
      .run(date, MARKER);
  }

  /** At the brief time, or on the first launch after it, write today's brief once. */
  async runIfDue(): Promise<boolean> {
    const ws = this.deps.workspace();
    if (!ws) return false;
    const now = this.now();
    if (!briefDue(now, this.deps.settings?.().time || ws.briefTime)) return false;
    const done = this.deps.db
      .prepare("SELECT 1 FROM briefs WHERE date = ? AND project_id = ?")
      .get(localDate(now), MARKER);
    if (done) return false;
    await this.run();
    return true;
  }

  /** The newest brief: its lines, and the facts per project that had news. */
  latest(): BriefView {
    const row = this.deps.db
      .prepare("SELECT MAX(date) AS date FROM briefs WHERE project_id != ?")
      .get(MARKER) as { date: string | null };
    if (!row.date) return { date: null, lines: [], items: [] };
    const rows = this.deps.db
      .prepare("SELECT project_id, markdown FROM briefs WHERE date = ? AND project_id != ?")
      .all(row.date, MARKER) as Array<{ project_id: string; markdown: string }>;
    const projects = this.deps.workspace()?.projects ?? [];
    let lines: BriefLine[] = [];
    const items: BriefItem[] = [];
    for (const r of rows) {
      if (r.project_id === LINES) {
        try {
          lines = JSON.parse(r.markdown) as BriefLine[];
        } catch {
          lines = [];
        }
        continue;
      }
      items.push({
        projectId: r.project_id,
        projectName: projects.find((p) => p.id === r.project_id)?.name ?? r.project_id,
        markdown: r.markdown,
      });
    }
    if (this.deps.settings?.().enabled === false) {
      const activity = projects.filter((project) => items.some((item) => item.projectId === project.id))
        .map((project) => ({ project, commits: [], notes: [], sessions: [], runs: [] }));
      lines = plainBrief(activity, this.needsYou()).map((text) => ({ text, link: linkForLine(text, projects) }));
    }
    return { date: row.date, lines, items };
  }
}
