import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BriefItem, BriefView } from "../../../shared/models";
import type { Project, Workspace } from "../../../shared/types";
import type { Db } from "../../core/db";
import type { Notifier } from "../../core/notifier";
import { projectFolder } from "../../core/util";
import { git } from "../git/run";
import type { RunService } from "../runs/service";

const MARKER = "__run__";

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

/** The prompt for the one brief run: the facts per active project and the output format. */
export function buildBriefPrompt(activities: Activity[]): string {
  const lines = [
    "Write the owner's morning brief. For each project below, write two to four short lines of markdown on what changed yesterday.",
    "Use only the facts given. Output one section per project, headed exactly `## <project name>`.",
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
  return lines.join("\n");
}

/** Splits the model's answer on its `## <name>` headings. */
export function splitBrief(text: string, names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const parts = text.split(/^##\s+(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const name = (parts[i] ?? "").trim();
    const body = (parts[i + 1] ?? "").trim();
    if (names.includes(name) && body) out.set(name, body);
  }
  return out;
}

const fallbackBrief = (a: Activity): string =>
  [
    ...a.commits.map((c) => `- ${c}`),
    ...a.notes.map((n) => `- brain: ${n}`),
    ...a.sessions.map((s) => `- ${s}`),
    ...a.runs.map((r) => `- ${r}`),
  ].join("\n");

/** The morning brief: what changed per project yesterday, written by a cheap model. */
export class BriefService {
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

  /** Runs the brief now for today. Projects without activity are skipped. Returns how many were written. */
  async run(): Promise<{ date: string; count: number }> {
    const ws = this.deps.workspace();
    const now = this.now();
    const date = localDate(now);
    const role = ws?.roles["brief"];
    this.mark(date);
    if (!ws || !role) return { date, count: 0 };
    const activities = await this.collect(startOfYesterday(now));
    if (activities.length === 0) return { date, count: 0 };

    const handle = this.deps.runs.start({
      kind: "brief",
      providerId: role.provider,
      role,
      cwd: this.deps.workspaceRoot() || this.deps.projectsRoot(),
      prompt: buildBriefPrompt(activities),
    });
    const result = await handle.result;
    const sections = result.ok
      ? splitBrief(
          result.resultText,
          activities.map((a) => a.project.name),
        )
      : new Map<string, string>();
    const insert = this.deps.db.prepare(
      "INSERT INTO briefs (date, project_id, markdown) VALUES (?, ?, ?) ON CONFLICT(date, project_id) DO UPDATE SET markdown = excluded.markdown",
    );
    this.deps.db.transaction(() => {
      for (const a of activities)
        insert.run(date, a.project.id, sections.get(a.project.name) ?? fallbackBrief(a));
    })();
    this.deps.notifier.notify({
      kind: "brief.ready",
      title: "Your morning brief is ready",
      body: `${activities.length} project${activities.length === 1 ? "" : "s"} with news`,
      link: { view: "home" },
    });
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
    if (!briefDue(now, ws.briefTime)) return false;
    const done = this.deps.db
      .prepare("SELECT 1 FROM briefs WHERE date = ? AND project_id = ?")
      .get(localDate(now), MARKER);
    if (done) return false;
    await this.run();
    return true;
  }

  /** The newest brief, one item per project that had news. */
  latest(): BriefView {
    const row = this.deps.db
      .prepare("SELECT MAX(date) AS date FROM briefs WHERE project_id != ?")
      .get(MARKER) as { date: string | null };
    if (!row.date) return { date: null, items: [] };
    const rows = this.deps.db
      .prepare("SELECT project_id, markdown FROM briefs WHERE date = ? AND project_id != ?")
      .all(row.date, MARKER) as Array<{ project_id: string; markdown: string }>;
    const projects = this.deps.workspace()?.projects ?? [];
    const items: BriefItem[] = rows.map((r) => ({
      projectId: r.project_id,
      projectName: projects.find((p) => p.id === r.project_id)?.name ?? r.project_id,
      markdown: r.markdown,
    }));
    return { date: row.date, items };
  }
}
