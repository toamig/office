import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "../../core/exec";
import { IpcFailure } from "../../core/ipc";
import { writeTextFile } from "../../core/settings";
import { git } from "../git/run";
import { defaultWorkspace } from "../setup/workspace-setup";
import { writeStarterBrain } from "../vault/starter-layout";
import { StarterPack } from "../vault/starter-pack";

export interface BrainResult {
  path: string;
  /** The config file inside the folder, relative to it. */
  configPath: string;
  /** The files the brain starts with, relative to the folder. */
  files: string[];
  github: { requested: boolean; repo?: string; error?: string };
}

export const BRAIN_CONFIG = "Office/workspace.json";

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === ".git") return [];
    const path = join(dir, e.name);
    return e.isDirectory()
      ? listFiles(path, base)
      : [path.slice(base.length + 1).replaceAll("\\", "/")];
  });
}

/**
 * Starts a new brain: one git repo (a "folder" vault) with the template's README and rules, a Projects folder and a
 * workspace config with no projects, committed. With `github`, a private repo is created and pushed; if that fails
 * the brain is still made, and the failure is reported.
 */
export async function createBrain(
  templateDir: string,
  folder: string,
  github: { name: string } | null,
): Promise<BrainResult> {
  const dir = resolve(folder);
  if (existsSync(dir) && readdirSync(dir).length > 0)
    throw new IpcFailure(
      "not-empty",
      `${dir} already has files in it. Pick an empty or new folder.`,
    );
  if (!existsSync(templateDir))
    throw new IpcFailure("no-template", "The brain template is missing from this install");
  mkdirSync(dir, { recursive: true });
  cpSync(templateDir, dir, { recursive: true });
  writeStarterBrain(dir);
  writeTextFile(join(dir, BRAIN_CONFIG), `${JSON.stringify(defaultWorkspace(false), null, 2)}\n`);
  const steps: Array<[string, string[]]> = [
    ["git init", ["init", "-q", "-b", "main"]],
    ["git add", ["add", "-A"]],
    ["git commit", ["commit", "-q", "-m", "Start the brain"]],
  ];
  for (const [label, args] of steps) {
    const out = await git(dir, args);
    if (out.code !== 0)
      throw new IpcFailure("git-failed", `${label} failed: ${firstLine(out.stderr || out.stdout)}`);
  }
  if (existsSync(join(templateDir, "Rules/rules.json"))) new StarterPack(dir, templateDir, true).trackCreation();
  const result: BrainResult = {
    path: dir,
    configPath: BRAIN_CONFIG,
    files: listFiles(dir).sort(),
    github: { requested: github !== null },
  };
  if (github) {
    const me = await run("gh", ["api", "user", "--jq", ".login"], { timeoutMs: 30_000 });
    const owner = me.stdout.trim();
    if (me.code !== 0 || !owner) {
      result.github.error = "Could not read your GitHub login. Run: gh auth login";
    } else {
      const made = await run(
        "gh",
        ["repo", "create", `${owner}/${github.name}`, "--private", "--source", dir, "--push"],
        { timeoutMs: 120_000 },
      );
      if (made.code === 0) result.github.repo = `${owner}/${github.name}`;
      else result.github.error = firstLine(made.stderr || made.stdout) || "gh repo create failed";
    }
  }
  return result;
}
