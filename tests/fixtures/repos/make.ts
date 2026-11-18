import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Runs git in `cwd` and returns stdout. Fixture helper only; app code goes through core/exec. */
export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function tmp(prefix = "office-repo-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function write(repo: string, file: string, content: string): void {
  const full = join(repo, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

export function commit(
  repo: string,
  file: string,
  content: string,
  message = `edit ${file}`,
): string {
  write(repo, file, content);
  sh(repo, "add", "--", file);
  sh(repo, "commit", "-q", "-m", message);
  return sh(repo, "rev-parse", "HEAD").trim();
}

export interface RepoPair {
  root: string;
  bare: string;
  work: string;
}

/** A bare remote plus a working clone with one pushed commit on main and its upstream set. */
export function makeRepoPair(): RepoPair {
  const root = tmp();
  const bare = join(root, "remote.git");
  const work = join(root, "work");
  mkdirSync(bare);
  sh(bare, "init", "-q", "--bare", "-b", "main");
  mkdirSync(work);
  sh(work, "init", "-q", "-b", "main");
  sh(work, "remote", "add", "origin", bare);
  commit(work, "README.md", "# fixture\n", "initial commit");
  sh(work, "push", "-q", "-u", "origin", "main");
  return { root, bare, work };
}

/** A second clone of the same remote, to create divergence from. */
export function cloneOf(pair: RepoPair, name = "other"): string {
  const dir = join(pair.root, name);
  execFileSync("git", ["clone", "-q", pair.bare, dir], { stdio: "ignore" });
  return dir;
}

/** Makes `work` conflict with the remote: both sides edit README.md differently. */
export function makeConflict(pair: RepoPair): void {
  const other = cloneOf(pair, "conflict-other");
  commit(other, "README.md", "# changed elsewhere\n", "remote edit");
  sh(other, "push", "-q");
  commit(pair.work, "README.md", "# changed locally\n", "local edit");
}
