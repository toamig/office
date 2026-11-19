import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SpawnInput, SpawnReport, SpawnStep } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import { run } from "../../core/exec";
import { IpcFailure } from "../../core/ipc";
import { writeTextFile } from "../../core/settings";
import { git } from "../git/run";
import type { RunService } from "../runs/service";
import type { SessionService } from "../sessions/service";
import { updateFromUpstream, type VaultWriter } from "../vault/writer";
import {
  addHubRow,
  addIgnoreLine,
  addRepoEntry,
  agentsText,
  brainIndex,
  brainJson,
  brainOpenItems,
  brainOverview,
  claudeText,
  folderName,
  gitattributesText,
  gitignoreText,
  mitLicense,
  readmeText,
  slugify,
} from "./files";

export interface SpawnDeps {
  workspace: () => Workspace | null;
  workspaceRoot: () => string;
  projectsRoot: () => string;
  workspaceFile: () => string;
  reloadWorkspace: () => void;
  writer: VaultWriter;
  sessions: SessionService;
  runs: RunService;
  /** Provider used for the exploration summary and the first session. */
  providerOf: (sessionId?: string) => string;
  onProgress?: (steps: SpawnStep[]) => void;
}

interface Resolved {
  input: SpawnInput;
  slug: string;
  folder: string;
  dir: string;
  vaultFolder: string;
  hub: boolean;
  vaultKind: "brain-hub" | "folder" | "none";
  description: string;
}

function resolveInput(deps: SpawnDeps, input: SpawnInput): Resolved {
  const ws = deps.workspace();
  if (!ws) throw new IpcFailure("no-workspace", "Set up a workspace first");
  const slug = slugify(input.name);
  if (!slug)
    throw new IpcFailure("bad-name", "Give the project a name with letters or digits in it");
  if (ws.projects.some((p) => p.id === slug))
    throw new IpcFailure("exists", `A project called "${slug}" already exists`);
  const folder = input.folder?.trim() || folderName(input.name);
  const dir = resolve(deps.projectsRoot(), folder);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new IpcFailure(
      "folder-not-empty",
      `${dir} already has files in it. Pick another folder name.`,
    );
  }
  if (input.visibility === "public" && !input.publicConfirmed) {
    throw new IpcFailure(
      "needs-confirm",
      "Creating a public repo needs its own explicit confirmation",
    );
  }
  const vaultFolder = folderName(input.name);
  // Checked here, before anything is created, so a taken name never leaves an orphan GitHub repo behind.
  const vaultDir = join(deps.workspaceRoot(), vaultFolder);
  if (ws.vault.kind === "brain-hub" && existsSync(vaultDir) && readdirSync(vaultDir).length > 0) {
    throw new IpcFailure(
      "vault-folder-exists",
      `The brain already has a folder called ${vaultFolder}. Pick another name.`,
    );
  }
  return {
    input,
    slug,
    folder,
    dir,
    vaultFolder,
    hub: ws.vault.kind === "brain-hub",
    vaultKind: ws.vault.kind,
    description: input.stack ? `${input.name}: ${input.stack}.` : `${input.name}, a new project.`,
  };
}

const step = (id: string, label: string, detail: string[]): SpawnStep => ({
  id,
  label,
  detail,
  status: "pending",
});

/** The checklist shown to the owner before anything runs. */
export function planSpawn(deps: SpawnDeps, input: SpawnInput): SpawnStep[] {
  const r = resolveInput(deps, { ...input, publicConfirmed: true });
  const vis = r.input.visibility;
  const steps: SpawnStep[] = [
    step("folder", "Create the code folder", [
      `mkdir ${r.dir}`,
      "git init -b main",
      `README.md, .gitattributes, .gitignore, AGENTS.md, CLAUDE.md${r.input.license === "mit" ? ", LICENSE (MIT)" : ""}`,
      "git commit: the first commit",
    ]),
    step("github", `Create the ${vis} GitHub repo and push`, [
      `gh repo create <you>/${r.slug} --${vis} --source ${r.folder} --push`,
    ]),
  ];
  if (r.hub) {
    steps.push(
      step("brain-repo", "Create the brain repo", [
        `${r.vaultFolder}/: brain.json, _index.md, Overview.md, OpenItems.md, .gitattributes`,
        "git init -b main, commit",
        `gh repo create <you>/brain-${r.slug} --private`,
        `git remote add origin git@github.com:<you>/brain-${r.slug}.git, git push`,
      ]),
      step("hub", "Register it in the hub", [
        `.gitignore: ${r.vaultFolder}/`,
        `brain.repos.json: ${r.vaultFolder}`,
        "_index.md: a row in the repo table",
        "node Common/tools/brain.mjs reindex, then validate",
        "node tools/hub.mjs readmes, then github",
        "commit only the hub files that changed",
      ]),
    );
  }
  if (r.vaultKind !== "none") {
    steps.push(
      step("notes", "Write the exploration's conclusions into the notes", [
        r.input.exploreSessionId
          ? "a headless run summarises the Explore session"
          : "no Explore session chosen: the notes stay as the template",
        `${r.vaultFolder}/Overview.md: "## Positioning and vision"`,
        `${r.vaultFolder}/OpenItems.md`,
      ]),
    );
  }
  steps.push(
    step("workspace", "Add the project to Office", [
      `workspace config: ${r.slug} in group ${r.input.group ?? "none"}`,
    ]),
    step("session", "Start an agent in the new folder", [
      "an interactive session whose first prompt is the summary",
    ]),
  );
  return steps;
}

interface Ctx {
  deps: SpawnDeps;
  r: Resolved;
  owner: string;
  summary: string;
  sessionId?: string;
}

async function must(
  label: string,
  result: Promise<{ code: number; stdout: string; stderr: string }>,
): Promise<string> {
  const out = await result;
  if (out.code !== 0)
    throw new Error(
      `${label} failed: ${(out.stderr || out.stdout).trim().split("\n")[0] ?? `exit ${out.code}`}`,
    );
  return out.stdout;
}

async function stepFolder(c: Ctx): Promise<string> {
  const { r } = c;
  mkdirSync(r.dir, { recursive: true });
  const license = r.input.license === "mit";
  const files: Array<[string, string]> = [
    ["README.md", readmeText(r.input.name, r.input.stack)],
    [".gitattributes", gitattributesText()],
    [".gitignore", gitignoreText()],
    ["AGENTS.md", agentsText(r.input.name, r.input.stack, r.hub ? `brain-${r.slug}` : null)],
    ["CLAUDE.md", claudeText()],
    ...(license
      ? ([["LICENSE", mitLicense(new Date().getFullYear(), c.owner)]] as Array<[string, string]>)
      : []),
  ];
  for (const [name, text] of files) writeTextFile(join(r.dir, name), text);
  await must("git init", git(r.dir, ["init", "-q", "-b", "main"]));
  await must("git add", git(r.dir, ["add", "-A"]));
  await must("git commit", git(r.dir, ["commit", "-q", "-m", `Start ${r.input.name}`]));
  return `${files.length} files committed`;
}

async function stepGithub(c: Ctx): Promise<string> {
  const { r } = c;
  await must(
    "gh repo create",
    run(
      "gh",
      [
        "repo",
        "create",
        `${c.owner}/${r.slug}`,
        `--${r.input.visibility}`,
        "--source",
        r.dir,
        "--push",
      ],
      { timeoutMs: 120_000 },
    ),
  );
  return `${c.owner}/${r.slug}`;
}

async function stepBrainRepo(c: Ctx): Promise<string> {
  const { r } = c;
  const dir = join(c.deps.workspaceRoot(), r.vaultFolder);
  if (existsSync(dir) && readdirSync(dir).length > 0)
    throw new Error(`${dir} already exists in the vault`);
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ["brain.json", brainJson(r.slug, r.vaultFolder, r.description)],
    ["_index.md", brainIndex(r.input.name, r.input.domain, r.description)],
    [
      "Overview.md",
      brainOverview(r.input.name, r.vaultFolder, r.input.domain, r.input.stack, r.input.visibility),
    ],
    ["OpenItems.md", brainOpenItems(r.input.name, r.input.domain)],
    [".gitattributes", gitattributesText()],
  ];
  for (const [name, text] of files) writeTextFile(join(dir, name), text);
  await must("git init", git(dir, ["init", "-q", "-b", "main"]));
  await must("git add", git(dir, ["add", "-A"]));
  await must("git commit", git(dir, ["commit", "-q", "-m", `${r.input.name}: start the notes`]));
  await must(
    "gh repo create",
    run("gh", ["repo", "create", `${c.owner}/brain-${r.slug}`, "--private"], {
      timeoutMs: 120_000,
    }),
  );
  await must(
    "git remote add",
    git(dir, ["remote", "add", "origin", `git@github.com:${c.owner}/brain-${r.slug}.git`]),
  );
  await must("git push", git(dir, ["push", "-q", "-u", "origin", "main"], { timeoutMs: 120_000 }));
  return `brain-${r.slug}`;
}

async function editHubFile(c: Ctx, name: string, edit: (text: string) => string): Promise<void> {
  const file = join(c.deps.workspaceRoot(), name);
  writeTextFile(file, edit(readFileSync(file, "utf8")));
}

const HUB_FILES = [".gitignore", "brain.repos.json", "_index.md"];

/** Registers the project in the hub, on the writer's queue so it never overlaps a vault write. */
function stepHub(c: Ctx): Promise<string> {
  return c.deps.writer.exclusive(() => registerInHub(c));
}

async function registerInHub(c: Ctx): Promise<string> {
  const root = c.deps.workspaceRoot();
  // The three hub files must be clean, and the hub up to date, before they are edited.
  const dirty = await git(root, ["status", "--porcelain", "--", ...HUB_FILES]);
  if (dirty.stdout.trim() !== "")
    throw new Error(
      `${HUB_FILES.join(", ")} have changes that are not committed in the hub; commit or discard them first`,
    );
  if ((await git(root, ["rev-parse", "--abbrev-ref", "@{u}"])).code === 0) {
    const problem = await updateFromUpstream(root);
    if (problem) throw new Error(problem.message);
  }
  let committed = false;
  try {
    const result = await editAndCommitHub(c, root, () => {
      committed = true;
    });
    return result;
  } catch (err) {
    // Until the hub commit exists, put the hub files back, so a failed registration leaves nothing edited.
    if (!committed) await git(root, ["checkout", "--", ...HUB_FILES]);
    throw err;
  }
}

async function editAndCommitHub(c: Ctx, root: string, onCommitted: () => void): Promise<string> {
  const { r } = c;
  await editHubFile(c, ".gitignore", (t) => addIgnoreLine(t, r.vaultFolder));
  await editHubFile(c, "brain.repos.json", (t) =>
    addRepoEntry(t, r.vaultFolder, `brain-${r.slug}`),
  );
  await editHubFile(c, "_index.md", (t) =>
    addHubRow(t, r.vaultFolder, r.description, r.input.domain),
  );
  await must(
    "brain reindex",
    run("node", [join(root, "Common", "tools", "brain.mjs"), "reindex"], {
      cwd: root,
      timeoutMs: 120_000,
    }),
  );
  const validate = await run("node", [join(root, "Common", "tools", "brain.mjs"), "validate"], {
    cwd: root,
    timeoutMs: 120_000,
  });
  if (validate.code !== 0)
    throw new Error(
      `brain validate failed: ${validate.stdout.split("\n").find((l) => l.startsWith("ERROR")) ?? "see the brain"}`,
    );
  await must(
    "hub readmes",
    run("node", [join(root, "tools", "hub.mjs"), "readmes"], { cwd: root, timeoutMs: 120_000 }),
  );
  await must(
    "hub github",
    run("node", [join(root, "tools", "hub.mjs"), "github"], { cwd: root, timeoutMs: 120_000 }),
  );
  // The new repo's own generated files (router table, front page) are committed there.
  const brainDir = join(root, r.vaultFolder);
  await git(brainDir, ["add", "-A"]);
  const staged = await git(brainDir, ["diff", "--cached", "--quiet"]);
  const notPushed: string[] = [];
  if (staged.code !== 0) {
    await must(
      "git commit",
      git(brainDir, ["commit", "-q", "-m", `${r.input.name}: router and front page`]),
    );
    const push = await git(brainDir, ["push", "-q"], { timeoutMs: 120_000 });
    if (push.code !== 0) notPushed.push(`${r.vaultFolder} (${firstLineOf(push.stderr)})`);
  }
  // The hub gets only the three files this step changed.
  await must("git add", git(root, ["add", "--", ...HUB_FILES]));
  const hubStaged = await git(root, ["diff", "--cached", "--quiet", "--", ...HUB_FILES]);
  if (hubStaged.code !== 0) {
    await must(
      "git commit",
      git(root, ["commit", "-q", "-m", `Add ${r.input.name} to the hub`, "--", ...HUB_FILES]),
    );
    onCommitted();
    const push = await git(root, ["push", "-q"], { timeoutMs: 120_000 });
    if (push.code !== 0) notPushed.push(`the hub (${firstLineOf(push.stderr)})`);
  }
  // A push that failed keeps its commit; the next sync retries it, so this is reported, not fatal.
  return notPushed.length > 0
    ? `registered, but not pushed: ${notPushed.join("; ")}. The next sync retries.`
    : "registered";
}

const firstLineOf = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

export const SUMMARY_PROMPT =
  "SUMMARY_OF_EXPLORATION. Summarise this exploration for the project's notes. Write two parts. Part 1, headed `## Positioning and vision`: what the project is, who it is for and why it is worth doing. Part 2, headed `## Open items`: a bullet list of the next steps and open questions.";

/** Splits the summary into the Overview section and the open-item bullets. */
export function splitSummary(text: string): { positioning: string; items: string[] } {
  const lines = text.split("\n");
  const find = (title: string): number =>
    lines.findIndex((l) => l.trim().toLowerCase() === `## ${title}`.toLowerCase());
  const section = (from: number): string[] => {
    if (from < 0) return [];
    const rest = lines.slice(from + 1);
    const end = rest.findIndex((l) => l.startsWith("## "));
    return end < 0 ? rest : rest.slice(0, end);
  };
  const positioningLines = section(find("Positioning and vision"));
  const positioning = (positioningLines.length > 0 ? positioningLines.join("\n") : text).trim();
  const items = section(find("Open items"))
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") || l.startsWith("* "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
  return { positioning, items };
}

async function stepNotes(c: Ctx): Promise<string> {
  const { r, deps } = c;
  const dir = join(deps.workspaceRoot(), r.vaultFolder);
  if (r.vaultKind === "folder") {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of [
      [
        "Overview.md",
        brainOverview(
          r.input.name,
          r.vaultFolder,
          r.input.domain,
          r.input.stack,
          r.input.visibility,
        ),
      ],
      ["OpenItems.md", brainOpenItems(r.input.name, r.input.domain)],
    ] as const) {
      if (!existsSync(join(dir, name))) writeTextFile(join(dir, name), text);
    }
  }
  if (!r.input.exploreSessionId) return "template notes only";
  const session = deps.sessions.get(r.input.exploreSessionId);
  const providerId = deps.providerOf(session.id);
  const handle = deps.runs.start({
    kind: "explore-summary",
    providerId,
    role: { provider: providerId, instructions: "", readOnly: true, allowedCommands: [] },
    cwd: session.cwd,
    prompt: SUMMARY_PROMPT,
    resumeId: session.providerSessionId ?? session.id,
  });
  const done = await handle.result;
  if (!done.ok) throw new Error(`the summary run failed: ${done.error ?? "unknown error"}`);
  c.summary = done.resultText;
  const { positioning, items } = splitSummary(done.resultText);
  const overview = join(dir, "Overview.md");
  const items2 = join(dir, "OpenItems.md");
  await deps.writer.edit(
    overview,
    `${r.input.name}: positioning and vision`,
    (t) => `${t.replace(/\s+$/, "")}\n\n## Positioning and vision\n\n${positioning}\n`,
  );
  for (const item of items)
    await deps.writer.addToSection(items2, "Open items", `- ${item}`, `${r.input.name}: open item`);
  return `${items.length} open item(s)`;
}

async function stepWorkspace(c: Ctx): Promise<string> {
  const { r, deps } = c;
  const file = deps.workspaceFile();
  await deps.writer.edit(file, `${r.input.name}: add to the workspace`, (text) => {
    const json = JSON.parse(text) as { projects: Array<Record<string, unknown>> };
    json.projects.push({
      id: r.slug,
      name: r.input.name,
      path: r.folder,
      ...(r.vaultKind !== "none" ? { vault: r.vaultFolder } : {}),
      ...(r.input.group ? { group: r.input.group } : {}),
      pinned: false,
      archived: false,
    });
    return `${JSON.stringify(json, null, 2)}\n`;
  });
  deps.reloadWorkspace();
  return r.slug;
}

async function stepSession(c: Ctx): Promise<string> {
  const { r, deps } = c;
  const providerId = deps.providerOf(r.input.exploreSessionId);
  const prompt = c.summary
    ? `This project was just created from an exploration. Here is the summary:\n\n${c.summary}\n\nRead AGENTS.md and the notes, then propose the first steps.`
    : "This project was just created. Read AGENTS.md and the notes, then propose the first steps.";
  const session = deps.sessions.start({
    providerId,
    projectId: r.slug,
    cwd: r.dir,
    title: r.input.name,
    prompt,
  });
  c.sessionId = session.id;
  return session.id;
}

async function githubOwner(): Promise<string> {
  const out = await run("gh", ["api", "user", "--jq", ".login"], { timeoutMs: 30_000 });
  const login = out.stdout.trim();
  if (out.code !== 0 || !login)
    throw new Error("Could not read your GitHub login. Run: gh auth login");
  return login;
}

const runners: Record<string, (c: Ctx) => Promise<string>> = {
  folder: stepFolder,
  github: stepGithub,
  "brain-repo": stepBrainRepo,
  hub: stepHub,
  notes: stepNotes,
  workspace: stepWorkspace,
  session: stepSession,
};

/** Runs the confirmed checklist. A failed step stops it; nothing that was already pushed is rolled back. */
export async function runSpawn(deps: SpawnDeps, input: SpawnInput): Promise<SpawnReport> {
  const r = resolveInput(deps, input);
  const steps = planSpawn(deps, input);
  deps.onProgress?.(steps);
  let owner: string;
  try {
    owner = await githubOwner();
  } catch (err) {
    steps[0] = { ...(steps[0] as SpawnStep), status: "failed", result: (err as Error).message };
    deps.onProgress?.(steps);
    return { steps, ok: false, failedAt: steps[0]?.id ?? "folder" };
  }
  const ctx: Ctx = { deps, r, owner, summary: "" };
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i] as SpawnStep;
    steps[i] = { ...current, status: "running" };
    deps.onProgress?.(steps);
    try {
      const result = await (runners[current.id] as (c: Ctx) => Promise<string>)(ctx);
      steps[i] = { ...current, status: "done", result };
    } catch (err) {
      steps[i] = { ...current, status: "failed", result: (err as Error).message };
      deps.onProgress?.(steps);
      return { steps, ok: false, failedAt: current.id };
    }
    deps.onProgress?.(steps);
  }
  return {
    steps,
    ok: true,
    projectId: r.slug,
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
  };
}

/**
 * A notes repo for a project that already has its code (adding projects, M9): the brain-repo and hub steps of the
 * spawn checklist, on their own. Answers the notes folder in the hub.
 */
export async function createNotesRepo(
  deps: SpawnDeps,
  name: string,
  domain: SpawnInput["domain"],
  stack: string,
): Promise<string> {
  const slug = slugify(name);
  const folder = folderName(name);
  if (!slug)
    throw new IpcFailure("bad-name", "Give the project a name with letters or digits in it");
  const input: SpawnInput = {
    name,
    visibility: "private",
    license: "none",
    stack,
    domain,
    publicConfirmed: false,
  };
  const r: Resolved = {
    input,
    slug,
    folder,
    dir: "",
    vaultFolder: folder,
    hub: true,
    vaultKind: "brain-hub",
    description: stack ? `${name}: ${stack}.` : `${name}, a project.`,
  };
  const c: Ctx = { deps, r, owner: await githubOwner(), summary: "" };
  await stepBrainRepo(c);
  await stepHub(c);
  return folder;
}
