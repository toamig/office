/** What Office knows about a problem, gathered before a session is started to fix it. */
export interface FixFacts {
  /** What failed, in one sentence. */
  what: string;
  /** Where: the project, branch, run or folder. */
  where: string;
  /** The exact error or output, already trimmed. */
  output?: string;
  /** The files involved. */
  files?: string[];
  /** What done means, so the session knows when to stop. */
  done: string;
}

/** The first message of a Fix session: everything Office knows, written to the agent as the owner's own words. */
export function buildFixBrief(f: FixFacts): string {
  const parts = [
    "Please fix this problem. Office noticed it, and everything it knows is below.",
    "",
    `What failed: ${f.what}`,
    `Where: ${f.where}`,
  ];
  if (f.output?.trim()) {
    const longest = Math.max(2, ...(f.output.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(longest + 1);
    parts.push("", "The exact error or output:", "", fence, f.output.trim(), fence);
  }
  if (f.files && f.files.length > 0)
    parts.push("", "Files involved:", ...f.files.map((file) => `- ${file}`));
  parts.push(
    "",
    `Done means: ${f.done}`,
    "",
    "You are in the folder where the problem lives. Make the smallest change that fixes it, ask me before anything you are unsure about, and tell me what you changed.",
  );
  return parts.join("\n");
}

export async function failedRunDetails(
  exec: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>,
  id: string,
  dir: string,
): Promise<{ step: string | null; text: string }> {
  const logs = await exec("gh", ["run", "view", id, "--log-failed"], dir);
  if (logs.code === 0) return trimFailedLog(logs.stdout);
  const missing = "GitHub no longer has this run's log";
  try {
    const result = await exec("gh", ["run", "view", id, "--json", "jobs"], dir);
    if (result.code !== 0) return { step: null, text: missing };
    const data = JSON.parse(result.stdout) as { jobs?: Array<{
      name?: string; conclusion?: string; steps?: Array<{ name?: string; conclusion?: string }>;
    }> };
    const failed = (state?: string) => state === "failure" || state === "timed_out" || state === "startup_failure";
    const jobs = (data.jobs ?? []).filter((job) => failed(job.conclusion)).slice(0, 20);
    const steps = jobs.flatMap((job) => {
      const name = job.name || "Unnamed job";
      const failedSteps = job.steps?.filter((step) => failed(step.conclusion)) ?? [];
      return failedSteps.length ? failedSteps.map((step) => `${name} / ${step.name || "Unnamed step"}`) : [name];
    });
    return { step: steps[0] ?? null, text: [missing, ...steps.slice(0, 40).map((step) => `- ${step}`)].join("\n").slice(0, 6000) };
  } catch {
    return { step: null, text: missing };
  }
}

/** The goal of a Fix session: "Fix: the problem in a few words", at most about 70 characters. */
export function fixTitle(problem: string): string {
  const clean = problem
    .replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const text = clean.length > 70 ? `${clean.slice(0, 67).trimEnd()}...` : clean;
  return text.toLowerCase().startsWith("fix:") ? text : `Fix: ${text}`;
}

/** The numeric id of a GitHub Actions run from its address, for `gh run view <id> --log-failed`. */
export function runIdOf(url: string): string | null {
  return /\/actions\/runs\/(\d+)/.exec(url)?.[1] ?? null;
}

/**
 * `gh run view --log-failed` prints every failing step as lines of `job<TAB>step<TAB>timestamp text`. The brief needs
 * the failing step, not the whole log: the last failing step's lines, without the prefixes, cut to a length that fits.
 */
export function trimFailedLog(
  log: string,
  maxLines = 60,
  maxChars = 6000,
): { step: string | null; text: string } {
  const lines = log.split(/\r?\n/).filter((l) => l.trim().length > 0);
  type Group = { step: string; lines: string[] };
  const groups: Group[] = [];
  for (const line of lines) {
    const [job, step, ...rest] = line.split("\t");
    if (rest.length === 0 || job === undefined || step === undefined) {
      // A line without the prefixes belongs to whatever step came before it.
      let target = groups.at(-1);
      if (!target) {
        target = { step: "", lines: [] };
        groups.push(target);
      }
      target.lines.push(line);
      continue;
    }
    const name = `${job.trim()} / ${step.trim()}`;
    const text = rest.join("\t").replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "");
    const last = groups.at(-1);
    if (last && last.step === name) last.lines.push(text);
    else groups.push({ step: name, lines: [text] });
  }
  const failing = groups.at(-1);
  if (!failing) return { step: null, text: "" };
  let text = failing.lines.slice(-maxLines).join("\n");
  if (text.length > maxChars) text = `...${text.slice(-maxChars)}`;
  return { step: failing.step || null, text };
}

/** Paths that look like files in some output ("src/a/b.ts:12:3", "tests\\x.spec.ts"), most often named first. */
export function filesFromText(text: string, max = 12): string[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(
    /(?:^|[\s("'`])((?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]{1,6})(?=[:()"'`\s,]|$)/gm,
  )) {
    const file = (m[1] ?? "").replace(/\\/g, "/");
    if (/^(https?|node_modules)\b|node_modules\//.test(file)) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([f]) => f);
}
