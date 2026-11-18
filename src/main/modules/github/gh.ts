import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GithubOverview, PrInfo, RunInfo } from "../../../shared/models";
import type { Notifier } from "../../core/notifier";
import { run } from "../../core/exec";
import { mapLimit } from "../../core/util";
import type { ProjectService } from "../git/service";
import { readOrigin } from "../git/status";

const PrRow = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  headRefName: z.string(),
  reviewDecision: z.string().nullable().optional(),
  url: z.string(),
});
const RunRow = z.object({
  name: z.string().optional().default(""),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
  headBranch: z.string().optional().default(""),
  url: z.string(),
});

/** gh prints "" for an undecided review; the UI treats that as no decision. */
export function parsePrs(json: string): PrInfo[] {
  try {
    const rows = z.array(PrRow).parse(JSON.parse(json));
    return rows.map((r) => ({ ...r, reviewDecision: r.reviewDecision ? r.reviewDecision : null }));
  } catch {
    return [];
  }
}

export function parseRuns(json: string): RunInfo[] {
  try {
    const rows = z.array(RunRow).parse(JSON.parse(json));
    return rows.map((r) => ({ ...r, conclusion: r.conclusion ? r.conclusion : null }));
  } catch {
    return [];
  }
}

/** True for github.com origins in https, ssh or scp form. */
export function isGithubOrigin(url: string | null): boolean {
  return url !== null && /(^|[@/])github\.com[:/]/i.test(url);
}

export const PR_FIELDS = "number,title,state,headRefName,reviewDecision,url";
export const RUN_FIELDS = "status,conclusion,name,headBranch,url";

/** Open PRs and the last CI runs of a repo, through `gh`. Failures come back as an error text. */
export async function fetchOverview(
  repoPath: string,
  origin: string | null,
): Promise<GithubOverview> {
  if (!isGithubOrigin(origin)) return { isGithub: false, prs: [], runs: [] };
  const [prs, runs] = await Promise.all([
    run("gh", ["pr", "list", "--json", PR_FIELDS], { cwd: repoPath, timeoutMs: 30_000 }),
    run("gh", ["run", "list", "--limit", "5", "--json", RUN_FIELDS], {
      cwd: repoPath,
      timeoutMs: 30_000,
    }),
  ]);
  const failed = prs.code !== 0 ? prs : runs.code !== 0 ? runs : null;
  return {
    isGithub: true,
    prs: prs.code === 0 ? parsePrs(prs.stdout) : [],
    runs: runs.code === 0 ? parseRuns(runs.stdout) : [],
    ...(failed ? { error: (failed.stderr.trim().split("\n")[0] ?? "") || "gh failed" } : {}),
  };
}

/** Polls GitHub for the projects that live there, and raises ci.failed and pr.review-requested. */
export class GithubService {
  private timer: NodeJS.Timeout | undefined;
  private readonly seen = new Set<string>();

  constructor(private readonly deps: { projects: ProjectService; notifier: Notifier }) {}

  async overview(projectId: string): Promise<GithubOverview> {
    const project = this.deps.projects.find(projectId);
    if (!project) return { isGithub: false, prs: [], runs: [] };
    const path = this.deps.projects.absPath(project);
    if (!existsSync(join(path, ".git"))) return { isGithub: false, prs: [], runs: [] };
    return fetchOverview(path, await readOrigin(path));
  }

  /** One pass over every non-archived project with a GitHub origin. */
  async poll(): Promise<void> {
    const projects = this.deps.projects.list().filter((p) => !p.archived && p.isRepo);
    await mapLimit(projects, 2, async (p) => {
      const info = await this.overview(p.id);
      if (!info.isGithub || info.error) return;
      this.notifyFailures(p.id, p.name, info.runs);
      await this.notifyReviewRequests(p.id, p.name);
    });
  }

  private notifyFailures(projectId: string, name: string, runs: RunInfo[]): void {
    for (const r of runs) {
      if (r.conclusion !== "failure" || this.seen.has(r.url)) continue;
      this.seen.add(r.url);
      this.deps.notifier.notify({
        kind: "ci.failed",
        projectId,
        title: `CI failed in ${name}`,
        body: `${r.name} on ${r.headBranch}`,
        link: { view: "git", params: { project: projectId, tab: "prs" } },
      });
    }
  }

  private async notifyReviewRequests(projectId: string, name: string): Promise<void> {
    const project = this.deps.projects.find(projectId);
    if (!project) return;
    const out = await run(
      "gh",
      ["pr", "list", "--search", "review-requested:@me", "--json", PR_FIELDS],
      {
        cwd: this.deps.projects.absPath(project),
        timeoutMs: 30_000,
      },
    );
    if (out.code !== 0) return;
    for (const pr of parsePrs(out.stdout)) {
      if (this.seen.has(pr.url)) continue;
      this.seen.add(pr.url);
      this.deps.notifier.notify({
        kind: "pr.review-requested",
        projectId,
        title: `Review requested in ${name}: #${pr.number}`,
        body: pr.title,
        link: { view: "git", params: { project: projectId, tab: "prs" } },
      });
    }
  }

  /** Every 5 minutes while the app is open (plan 13, M3.5). */
  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.poll().catch(() => undefined), 5 * 60 * 1000);
    setTimeout(() => void this.poll().catch(() => undefined), 15_000).unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
