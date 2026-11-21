import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { Workspace as WorkspaceSchema } from "../../../shared/schemas";
import type { Workspace } from "../../../shared/types";
import { IpcFailure } from "../../core/ipc";
import { run } from "../../core/exec";
import { writeTextFile } from "../../core/settings";
import { projectFolder } from "../../core/util";
import { folderName, slugify } from "../explore/files";
import { git } from "../git/run";
import type { VaultWriter } from "../vault/writer";
import { updateStarterRouter, writeProjectLayout } from "../vault/starter-layout";
import { createBrain, type BrainResult } from "./brain";
import {
  defaultTarget,
  hasPointer,
  installPointer,
  pointerBlock,
  removePointer,
  TARGET_FILE,
  type PointerInfo,
  type PointerTarget,
} from "./pointer";
import { noteFolders, scanProjects, type Candidate } from "./scan";

type Domain = "ue5" | "saas" | "webgames" | "mobile" | "meta";

export interface OnboardingDeps {
  workspace: () => Workspace | null;
  workspaceRoot: () => string;
  projectsRoot: () => string;
  projectPaths: () => Record<string, string>;
  workspaceFile: () => string;
  reloadWorkspace: () => void;
  writer: VaultWriter;
  templateDir: () => string;
  /** Makes a notes repo for a project inside a brain hub (the spawn steps of M2.8), answering its folder. */
  notesRepo: (name: string, domain: Domain, stack: string) => Promise<string>;
}

export const AddItem = z.object({
  path: z.string(),
  name: z.string().min(1),
  group: z.string().optional(),
  /** "new": write Overview and OpenItems; "link": use the notes folder that exists; "none": no notes. */
  notes: z.enum(["new", "link", "none"]),
  /** For "link": the notes folder relative to the brain. */
  linkFolder: z.string().optional(),
  /** For a hub: "repo" makes a new notes repo, "folder" puts the notes in a folder of an existing notes repo. */
  hub: z.enum(["repo", "folder"]).optional(),
  hubFolder: z.string().optional(),
  domain: z.enum(["ue5", "saas", "webgames", "mobile", "meta"]).default("saas"),
});
export type AddItem = z.infer<typeof AddItem>;

export interface OnboardingStep {
  id: string;
  label: string;
  status: "done" | "failed" | "pending";
  result?: string;
}

export interface AddReport {
  ok: boolean;
  steps: OnboardingStep[];
  added: string[];
}

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

/** Adding projects by scanning, notes for each, the agent pointer, and removing a project from Office. */
export class OnboardingService {
  constructor(private readonly deps: OnboardingDeps) {}

  private kind(): "folder" | "brain-hub" | "none" {
    return this.deps.workspace()?.vault.kind ?? "folder";
  }

  /** The code repos under the projects folder that are not in the workspace yet. */
  async scan(): Promise<Candidate[]> {
    const ws = this.deps.workspace();
    const known = (ws?.projects ?? []).map((p) =>
      projectFolder(this.deps.projectsRoot(), p, this.deps.projectPaths()),
    );
    return scanProjects(
      this.deps.projectsRoot(),
      known,
      noteFolders(this.deps.workspaceRoot(), this.kind()),
    );
  }

  /** The nested notes repos of a brain hub (top-level folders with their own .git). */
  hubRepos(): string[] {
    const root = this.deps.workspaceRoot();
    if (this.kind() !== "brain-hub" || !root || !existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() && !e.name.startsWith(".") && existsSync(join(root, e.name, ".git")),
      )
      .map((e) => e.name);
  }

  /** The brain's folders that have an Overview but no project, for the owner to pair with code folders. */
  unmatchedNotes(): string[] {
    const ws = this.deps.workspace();
    const used = new Set((ws?.projects ?? []).map((p) => p.vault).filter(Boolean));
    return noteFolders(this.deps.workspaceRoot(), this.kind()).filter((n) => !used.has(n));
  }

  /** A project entry's path: relative to the projects folder when it is inside it, else absolute. */
  private entryPath(path: string): string {
    const rel = relative(this.deps.projectsRoot(), path);
    return rel && !rel.startsWith("..") && resolve(this.deps.projectsRoot(), rel) === resolve(path)
      ? rel.replaceAll("\\", "/")
      : resolve(path);
  }

  /** What Add will do for these items, in words, before anything runs. */
  plan(items: AddItem[]): string[] {
    return items.map((item) => {
      const notes =
        item.notes === "new"
          ? this.kind() === "brain-hub"
            ? item.hub === "repo"
              ? "a new notes repo in the brain hub (private, on GitHub)"
              : `the project notes in ${item.hubFolder ?? "a notes repo"}`
            : `Projects/${folderName(item.name)}/Overview.md, the project notes and their router`
          : item.notes === "link"
            ? `uses the notes in ${item.linkFolder ?? "the brain"}`
            : "no notes";
      const group = item.group ? ` (group ${item.group})` : "";
      return `${item.name}: add to the workspace config${group}; ${notes}`;
    });
  }

  /** Adds each item in turn, one commit per project. A failed item stops the rest and says what was and was not done. */
  async add(items: AddItem[]): Promise<AddReport> {
    const steps: OnboardingStep[] = [];
    const added: string[] = [];
    for (const item of items) {
      const step: OnboardingStep = { id: item.path, label: item.name, status: "pending" };
      steps.push(step);
      try {
        step.result = await this.addOne(item);
        step.status = "done";
        added.push(item.name);
      } catch (err) {
        step.status = "failed";
        step.result = (err as Error).message;
        return { ok: false, steps, added };
      }
    }
    return { ok: true, steps, added };
  }

  private async addOne(item: AddItem): Promise<string> {
    const ws = this.deps.workspace();
    if (!ws) throw new IpcFailure("no-workspace", "Set up a workspace first");
    if (!existsSync(item.path)) throw new IpcFailure("no-folder", `${item.path} is not there`);
    const id = this.freeId(ws, slugify(item.name));
    const root = this.deps.workspaceRoot();
    const heading = ws.vault.waitingHeading;
    const remote =
      (await git(item.path, ["config", "--get", "remote.origin.url"])).stdout.trim() || null;
    const where = `\`${basename(item.path)}\``;
    const overview = `**Code:** ${where}${remote ? ` (${remote})` : ""}`;

    // A new notes repo registers itself in the hub on the writer's queue, so it is made before this item takes the queue.
    const newRepo =
      item.notes === "new" && this.kind() === "brain-hub" && item.hub === "repo"
        ? await this.deps.notesRepo(item.name, item.domain, "")
        : null;

    return this.deps.writer.exclusive(async () => {
      let vault: string | undefined;
      let rootRouter = false;
      // The repo that holds the notes when it is not the workspace repo (a notes repo inside a hub).
      let notesRepoDir: string | null = null;
      if (item.notes === "link") {
        if (!item.linkFolder) throw new IpcFailure("no-notes", "Say which notes folder to use");
        vault = item.linkFolder;
      } else if (item.notes === "new" && this.kind() === "folder") {
        vault = `Projects/${folderName(item.name)}`;
        const dir = join(root, vault);
        if (existsSync(join(dir, "Overview.md")))
          throw new IpcFailure("notes-exist", `${vault} already has notes; link them instead`);
        writeProjectLayout(root, vault, item.name, item.domain, { overview, waitingHeading: heading });
        rootRouter = await updateStarterRouter(root, [...ws.projects.flatMap((project) => project.vault ? [project.vault] : []), vault]);
      } else if (item.notes === "new" && this.kind() === "brain-hub") {
        if (newRepo) {
          vault = newRepo;
        } else {
          const repo = item.hubFolder;
          if (!repo || !existsSync(join(root, repo, ".git")))
            throw new IpcFailure("no-notes-repo", "Pick the notes repo to put the notes in");
          vault = `${repo}/${folderName(item.name)}`;
          writeProjectLayout(root, vault, item.name, item.domain, { overview, waitingHeading: heading, hub: true });
          notesRepoDir = join(root, repo);
        }
      }

      if (notesRepoDir && vault) {
        const rel = relative(notesRepoDir, join(root, vault)).replaceAll("\\", "/");
        await this.commit(notesRepoDir, [rel], `Add notes for ${item.name}`);
      }

      const file = this.deps.workspaceFile();
      const json = JSON.parse(readFileSync(file, "utf8")) as {
        projects: Array<Record<string, unknown>>;
      };
      json.projects.push({
        id,
        name: item.name,
        path: this.entryPath(item.path),
        ...(vault ? { vault } : {}),
        ...(item.group ? { group: item.group } : {}),
        pinned: false,
        archived: false,
      });
      const checked = WorkspaceSchema.safeParse(json);
      if (!checked.success)
        throw new IpcFailure(
          "invalid",
          `The workspace config would not be valid: ${checked.error.issues[0]?.message ?? ""}`,
        );
      writeTextFile(file, `${JSON.stringify(json, null, 2)}\n`);

      // One commit per project: the workspace entry, and the notes when they live in the same repo.
      const top = (await git(dirname(file), ["rev-parse", "--show-toplevel"])).stdout.trim();
      const paths = [relative(top, file).replaceAll("\\", "/")];
      if (rootRouter) paths.push(relative(top, join(root, "_index.md")).replaceAll("\\", "/"));
      if (vault && !notesRepoDir && item.notes === "new" && this.kind() === "folder")
        paths.push(relative(top, join(root, vault)).replaceAll("\\", "/"));
      await this.commit(top, paths, `Add project ${item.name}`);
      this.deps.reloadWorkspace();
      return id;
    });
  }

  /** Stages exactly these paths and commits them; pushes when the repo has an upstream (a failed push is not fatal). */
  private async commit(
    repo: string,
    paths: string[],
    message: string,
    mayPush = true,
  ): Promise<void> {
    const add = await git(repo, ["add", "--", ...paths]);
    if (add.code !== 0)
      throw new IpcFailure("git-failed", `git add failed: ${firstLine(add.stderr)}`);
    const done = await git(repo, ["commit", "-q", "-m", message, "--", ...paths]);
    if (done.code !== 0)
      throw new IpcFailure(
        "git-failed",
        `git commit failed: ${firstLine(done.stderr || done.stdout)}`,
      );
    if (mayPush && (await git(repo, ["rev-parse", "--abbrev-ref", "@{u}"])).code === 0)
      await git(repo, ["push", "--quiet"], { timeoutMs: 60_000 });
  }

  private freeId(ws: Workspace, base: string): string {
    const stem = base || "project";
    let id = stem;
    for (let n = 2; ws.projects.some((p) => p.id === id); n++) id = `${stem}-${n}`;
    return id;
  }

  /** Remove from Office: the workspace entry goes; the notes, the code and the pointer stay. */
  async remove(id: string): Promise<void> {
    await this.deps.writer.edit(
      this.deps.workspaceFile(),
      `Remove project ${id} from Office`,
      (text) => {
        const json = JSON.parse(text) as { projects: Array<{ id: string }> };
        if (!json.projects.some((p) => p.id === id))
          throw new IpcFailure("not-found", `No project ${id}`);
        json.projects = json.projects.filter((p) => p.id !== id);
        return `${JSON.stringify(json, null, 2)}\n`;
      },
    );
    this.deps.reloadWorkspace();
  }

  // ---------- the agent pointer ----------

  /** The folder the notes live in on this PC: the project's notes folder if it exists, else the brain's root. */
  private notesPath(folder: string): string {
    return resolve(this.deps.workspaceRoot(), folder).replaceAll("\\", "/");
  }

  /** The brain's git remote ("origin"), asked of the repo that holds the notes, or null when it has none. */
  private async brainRemote(notesPath: string): Promise<string | null> {
    const at = existsSync(notesPath) ? notesPath : this.deps.workspaceRoot();
    if (!existsSync(at)) return null;
    const out = await git(at, ["remote", "get-url", "origin"], { timeoutMs: 10_000 });
    const url = out.code === 0 ? firstLine(out.stdout) : "";
    return url === "" ? null : url;
  }

  /** Whether GitHub says the code repo is public: "PUBLIC", "PRIVATE", "INTERNAL", or null when gh cannot say. */
  private async visibilityOf(dir: string): Promise<string | null> {
    if (!existsSync(dir)) return null;
    const out = await run("gh", ["repo", "view", "--json", "visibility"], {
      cwd: dir,
      timeoutMs: 20_000,
    });
    if (out.code !== 0) return null;
    try {
      const v = (JSON.parse(out.stdout) as { visibility?: unknown }).visibility;
      return typeof v === "string" && v !== "" ? v : null;
    } catch {
      return null;
    }
  }

  private async pointerInfo(
    id: string,
  ): Promise<{ info: PointerInfo; dir: string; name: string; visibility: string | null }> {
    const ws = this.deps.workspace();
    const project = ws?.projects.find((p) => p.id === id);
    if (!ws || !project) throw new IpcFailure("not-found", `No project ${id}`);
    const dir = projectFolder(this.deps.projectsRoot(), project, this.deps.projectPaths());
    const notesFolder = project.vault ?? `Projects/${folderName(project.name)}`;
    const notesPath = this.notesPath(notesFolder);
    const [remote, visibility] = await Promise.all([
      this.brainRemote(notesPath),
      this.visibilityOf(dir),
    ]);
    return {
      name: project.name,
      dir,
      visibility,
      info: { name: project.name, notesPath, notesFolder, remote },
    };
  }

  /** What the pointer would do for a project: the exact text, where it goes by default, and which files each choice creates. */
  async pointerPreview(id: string): Promise<{
    project: string;
    file: string;
    text: string;
    creates: { agents: string[]; local: string[] };
    installed: boolean;
    target: PointerTarget;
    visibility: string | null;
  }> {
    const { info, dir, name, visibility } = await this.pointerInfo(id);
    const agents = join(dir, TARGET_FILE.agents);
    const local = join(dir, TARGET_FILE.local);
    const claude = join(dir, "CLAUDE.md");
    const creates = {
      agents: [
        ...(existsSync(agents) ? [] : [TARGET_FILE.agents]),
        ...(!existsSync(agents) && !existsSync(claude) ? ["CLAUDE.md"] : []),
      ],
      local: existsSync(local) ? [] : [TARGET_FILE.local],
    };
    const target = defaultTarget(visibility);
    const has = (file: string): boolean =>
      existsSync(file) && hasPointer(readFileSync(file, "utf8"));
    return {
      project: name,
      file: target === "local" ? local : agents,
      text: pointerBlock(info),
      creates,
      installed: has(agents) || has(local),
      target,
      visibility,
    };
  }

  /** Writes the block, commits only the files it touched, and pushes only when asked. */
  async pointerApply(
    ids: string[],
    push: boolean,
    choice: "auto" | PointerTarget = "auto",
  ): Promise<AddReport> {
    const steps: OnboardingStep[] = [];
    for (const id of ids) {
      const step: OnboardingStep = { id, label: id, status: "pending" };
      steps.push(step);
      try {
        step.result = await this.applyOne(id, push, choice);
        step.status = "done";
      } catch (err) {
        step.status = "failed";
        step.result = (err as Error).message;
        return { ok: false, steps, added: [] };
      }
    }
    return { ok: true, steps, added: ids };
  }

  private async applyOne(
    id: string,
    push: boolean,
    choice: "auto" | PointerTarget,
  ): Promise<string> {
    const { info, dir, visibility } = await this.pointerInfo(id);
    const target = choice === "auto" ? defaultTarget(visibility) : choice;
    const file = join(dir, TARGET_FILE[target]);
    const original = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (original !== null && hasPointer(original)) return "already there";
    const block = pointerBlock(info);
    if (target === "local") {
      // Only this PC: never committed, and kept out of `git status` through the repo's own exclude file.
      writeTextFile(file, installPointer(original, block));
      await this.excludeLocally(dir, TARGET_FILE.local);
      return `${TARGET_FILE.local} (this PC only)`;
    }
    const claude = join(dir, "CLAUDE.md");
    const files = [TARGET_FILE.agents];
    const makeClaude = original === null && !existsSync(claude);
    writeTextFile(file, installPointer(original, block));
    if (makeClaude) {
      writeTextFile(claude, "@AGENTS.md\n");
      files.push("CLAUDE.md");
    }
    if (existsSync(join(dir, ".git"))) {
      // The pointer is published only when the owner ticked Push, so its commit never goes out on its own.
      await this.commit(dir, files, "Add the Office pointer", false);
      if (push) await git(dir, ["push", "--quiet"], { timeoutMs: 60_000 });
    }
    return files.join(" and ");
  }

  /** Adds a line to the repo's own .git/info/exclude (never a committed file), once. */
  private async excludeLocally(dir: string, line: string): Promise<void> {
    if (!existsSync(join(dir, ".git"))) return;
    const where = await git(dir, ["rev-parse", "--git-path", "info/exclude"]);
    if (where.code !== 0) return;
    const rel = firstLine(where.stdout);
    const file = isAbsolute(rel) ? rel : join(dir, rel);
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (text.split(/\r?\n/).includes(line)) return;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`);
  }

  /** Removes the block from whichever of the two files holds it, and a file only if Office made it and nothing else is in it. */
  async pointerRemove(ids: string[]): Promise<AddReport> {
    const steps: OnboardingStep[] = [];
    for (const id of ids) {
      const { dir } = await this.pointerInfo(id);
      const step: OnboardingStep = { id, label: id, status: "done", result: "no pointer" };
      steps.push(step);
      const removed: string[] = [];
      const agents = join(dir, TARGET_FILE.agents);
      if (existsSync(agents) && hasPointer(readFileSync(agents, "utf8"))) {
        const rest = removePointer(readFileSync(agents, "utf8"));
        const touched = [TARGET_FILE.agents];
        if (rest === "") {
          rmSync(agents);
          const claude = join(dir, "CLAUDE.md");
          if (existsSync(claude) && readFileSync(claude, "utf8") === "@AGENTS.md\n") {
            rmSync(claude);
            touched.push("CLAUDE.md");
          }
        } else writeTextFile(agents, rest);
        if (existsSync(join(dir, ".git")))
          await this.commit(dir, touched, "Remove the Office pointer", false);
        removed.push(TARGET_FILE.agents);
      }
      const local = join(dir, TARGET_FILE.local);
      if (existsSync(local) && hasPointer(readFileSync(local, "utf8"))) {
        const rest = removePointer(readFileSync(local, "utf8"));
        if (rest === "") rmSync(local);
        else writeTextFile(local, rest);
        removed.push(TARGET_FILE.local);
      }
      if (removed.length > 0) step.result = `removed from ${removed.join(" and ")}`;
    }
    return { ok: true, steps, added: ids };
  }

  // ---------- a new brain ----------

  createBrain(folder: string, github: { name: string } | null): Promise<BrainResult> {
    return createBrain(this.deps.templateDir(), folder, github);
  }
}
