import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localDate, type BriefLink } from "../../../shared/brief";
import type { Recap } from "../../../shared/recap";
import type { Project, Workspace } from "../../../shared/types";
import type { Db } from "../../core/db";
import { projectFolder } from "../../core/util";
import { recentCloudRuns, type CloudRunFact } from "../cloud/reports";
import { git } from "../git/run";
import { parseOpenItems } from "../vault/openitems";

export interface SessionFact { id: string; title: string; at: string; recap: Recap | null }
export interface CommitFact { sha: string; short: string; subject: string; at: string; files: string[] }
export interface NoteFact { name: string; file: string; subject: string; sha: string; at: string }
export interface OpenFact { text: string; heading: string; waiting: boolean }

/** Everything the brief may say about one project in the time it covers, each fact with the place it came from. */
export interface ProjectFacts {
  project: Project;
  sessions: SessionFact[];
  commits: CommitFact[];
  notes: NoteFact[];
  open: OpenFact[];
  /** Cloud routine runs reported for the project. Their words are third-party data. */
  cloud: CloudRunFact[];
  /** Where it stands in git: uncommitted files, unpushed commits, other branches. */
  stands: string[];
}

export interface FactEnv {
  db: Db;
  workspace: Workspace;
  projectsRoot: string;
  projectPaths: Record<string, string> | undefined;
  workspaceRoot: string;
}

const MAX_COMMITS = 40;
const MAX_FILES = 12;
const SEP = "\u001f";
const REC = "\u001e";

async function commitsSince(repo: string, since: string, paths: string[] = []): Promise<CommitFact[]> {
  if (!existsSync(repo)) return [];
  const result = await git(repo, [
    "log", `--since=${since}`, "--no-merges", "--name-only", `--format=${REC}%H${SEP}%h${SEP}%cI${SEP}%s`, `-n`, String(MAX_COMMITS),
    ...(paths.length ? ["--", ...paths] : []),
  ]);
  if (result.code !== 0) return [];
  return result.stdout.split(REC).filter((block) => block.trim()).map((block) => {
    const [head = "", ...rest] = block.split(/\r?\n/);
    const [sha = "", short = "", at = "", ...subject] = head.split(SEP);
    return { sha, short, at, subject: subject.join(SEP), files: rest.map((line) => line.trim()).filter(Boolean).slice(0, MAX_FILES) };
  });
}

/** The days (local dates) the owner worked in a project's sessions, chats and commits, for finding where "last time" starts. */
export async function activityDays(env: FactEnv, since: Date): Promise<Set<string>> {
  const days = new Set<string>();
  const cut = since.toISOString();
  for (const row of env.db.prepare("SELECT created_at AS a, updated_at AS b FROM sessions WHERE updated_at >= ? OR created_at >= ?").all(cut, cut) as Array<{ a: string; b: string }>) {
    for (const stamp of [row.a, row.b]) if (stamp && stamp >= cut) days.add(localDate(new Date(stamp)));
  }
  for (const row of env.db.prepare("SELECT at FROM session_recaps WHERE at >= ?").all(cut) as Array<{ at: string }>) days.add(localDate(new Date(row.at)));
  for (const project of env.workspace.projects) {
    if (project.archived) continue;
    const repo = projectFolder(env.projectsRoot, project, env.projectPaths);
    for (const commit of await commitsSince(repo, cut)) days.add(localDate(new Date(commit.at)));
  }
  return days;
}

function recapOf(row: { asked: string; done: string; unfinished: string; next_step: string | null }): Recap {
  const list = (json: string): string[] => { try { const value: unknown = JSON.parse(json); return Array.isArray(value) ? value.map(String) : []; } catch { return []; } };
  return { asked: row.asked, done: list(row.done), unfinished: list(row.unfinished), next: row.next_step };
}

export async function collectProjectFacts(env: FactEnv, project: Project, since: Date): Promise<ProjectFacts> {
  const cut = since.toISOString();
  const code = projectFolder(env.projectsRoot, project, env.projectPaths);
  const sessions = (env.db.prepare(`SELECT s.id, s.title, s.updated_at AS at, r.asked, r.done, r.unfinished, r.next_step
      FROM sessions s LEFT JOIN session_recaps r ON r.session_id = s.id
      WHERE s.project_id = ? AND s.incognito = 0 AND s.provider != 'terminal' AND (s.updated_at >= ? OR r.at >= ?) ORDER BY s.updated_at DESC LIMIT 12`)
    .all(project.id, cut, cut) as Array<{ id: string; title: string | null; at: string; asked: string | null; done: string; unfinished: string; next_step: string | null }>)
    .map((row): SessionFact => ({
      id: row.id, title: row.title ?? "A session", at: row.at,
      recap: row.asked ? recapOf({ asked: row.asked, done: row.done, unfinished: row.unfinished, next_step: row.next_step }) : null,
    }));
  const commits = await commitsSince(code, cut);
  const notes: NoteFact[] = [];
  const open: OpenFact[] = [];
  const stands: string[] = [];
  if (project.vault !== undefined && project.vault !== "." && env.workspace.vault.kind !== "none" && env.workspaceRoot) {
    const folder = join(env.workspaceRoot, project.vault);
    const own = existsSync(join(folder, ".git"));
    const changes = own ? await commitsSince(folder, cut) : await commitsSince(env.workspaceRoot, cut, [project.vault]);
    const prefix = `${project.vault.replaceAll("\\", "/")}/`;
    for (const change of changes) {
      for (const path of change.files) {
        const file = !own && path.startsWith(prefix) ? path.slice(prefix.length) : path;
        if (!/\.md$/i.test(file) || file.includes("/") || file.startsWith("_")) continue;
        notes.push({ name: file.replace(/\.md$/i, ""), file, subject: change.subject, sha: change.sha, at: change.at });
      }
    }
    try {
      const text = readFileSync(join(folder, env.workspace.vault.openItemsFile), "utf8");
      const parsed = parseOpenItems(text, env.workspace.vault.waitingHeading);
      for (const item of parsed.waiting) open.push({ text: item.text, heading: env.workspace.vault.waitingHeading, waiting: true });
      for (const group of parsed.groups) for (const item of group.items) if (item.checked === false) open.push({ text: item.text, heading: group.heading, waiting: false });
    } catch { /* no open items file */ }
  }
  if (existsSync(code)) {
    const status = await git(code, ["status", "--porcelain"]);
    const changed = status.code === 0 ? status.stdout.split(/\r?\n/).filter(Boolean).length : 0;
    if (changed > 0) stands.push(`${changed} uncommitted ${changed === 1 ? "file" : "files"}`);
    const ahead = await git(code, ["rev-list", "--count", "@{u}..HEAD"]);
    const unpushed = ahead.code === 0 ? Number(ahead.stdout.trim()) : 0;
    if (unpushed > 0) stands.push(`${unpushed} ${unpushed === 1 ? "commit" : "commits"} not pushed`);
    const branches = await git(code, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    const names = branches.code === 0 ? branches.stdout.split(/\r?\n/).filter(Boolean) : [];
    if (names.length > 1) stands.push(`${names.length} local branches: ${names.slice(0, 5).join(", ")}`);
  }
  const cloud = recentCloudRuns(env.db, project.id, since, 6);
  return { project, sessions, commits, notes, open, cloud, stands };
}

export const hasNews = (facts: ProjectFacts): boolean =>
  facts.sessions.length + facts.commits.length + facts.notes.length + facts.cloud.length > 0;

/** The links the brief uses: every one points to the exact thing. */
export const links = {
  session: (id: string): BriefLink => ({ view: "agents", params: { session: id } }),
  commit: (projectId: string, sha: string): BriefLink => ({ view: "git", params: { project: projectId, commit: sha } }),
  note: (projectId: string, name: string, section?: string): BriefLink => ({
    view: "project", params: { id: projectId, tab: "notes", note: name, ...(section ? { section } : {}) },
  }),
};
