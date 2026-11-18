import { run, type RunOptions, type RunResult } from "../../core/exec";

/** Environment for every git call: never prompt, never take optional locks. */
export const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

/** Runs `git -C <repo> ...args` through core/exec (no shell). */
export function git(repo: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run("git", ["-C", repo, ...args], { ...opts, env: { ...GIT_ENV, ...opts.env } });
}

/** Like git(), but throws with the stderr text when the command fails. */
export async function gitOk(repo: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const result = await git(repo, args, opts);
  if (result.code !== 0) {
    throw new Error(
      `git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`,
    );
  }
  return result.stdout;
}
