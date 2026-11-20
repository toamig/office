import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sh } from "./make";

/** The shape of a big, busy repo: many branches with remotes, many worktrees, a long history. */
export interface BigShape {
  /** Commits on the trunk. */
  commits: number;
  /** Branches, each started from an older trunk commit; every other one is merged back. */
  branches: number;
  /** Worktrees under `.claude/worktrees`, each on a branch of its own. */
  worktrees: number;
}

export const LUCKY_FLOCK: BigShape = { commits: 1300, branches: 120, worktrees: 60 };

const SUBJECTS = [
  "Fix the sheep counter when two flocks cross the bridge at the same moment in a level",
  "Add a very long subject that explains in too much detail what this change does to the game",
  "Merge remote-tracking branch 'origin/claude/fix-1.2.3-thing' into main",
  "Tune: v1.2.3 balance pass for wolves, rams and the golden sheep",
  "Refactor the save game loader (see https://example.com/issues/1234 for context and notes)",
];

/** Writes a git fast-import stream for `n` commits on `ref`, each a child of the one before. */
function chain(
  ref: string,
  from: string | null,
  n: number,
  start: number,
  prefix: string,
  file: (i: number) => string,
): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    const subject = `${prefix} ${i}: ${SUBJECTS[(start + i) % SUBJECTS.length]}`;
    out += `commit ${ref}\nmark :${start + i + 1}\ncommitter T <t@example.com> ${1_700_000_000 + (start + i) * 60} +0000\ndata ${Buffer.byteLength(subject)}\n${subject}\n`;
    if (i === 0 && from) out += `from ${from}\n`;
    out += `M 100644 inline ${file(i)}\ndata 2\n${i % 10}\n\n`;
  }
  return out;
}

/**
 * Grows the repo at `dir` (which already has a `main`) into the given shape, quickly: the history and the branches
 * come from one `git fast-import`, the remote branches are refs, and the worktrees are real ones. Branch names have
 * slashes and dots, like the ones an agent tool makes.
 */
export function growBigRepo(dir: string, shape: BigShape = LUCKY_FLOCK): void {
  const trunk = chain("refs/heads/main", "refs/heads/main^0", shape.commits, 0, "Trunk", (i) => `trunk/f${i % 50}.txt`);
  let stream = trunk;
  const names: string[] = [];
  for (let b = 0; b < shape.branches; b++) {
    const name = b % 3 === 0 ? `claude/fix-${b}.${b % 7}-the-thing` : `feature/area-${b}/work.v${b % 5}`;
    names.push(name);
    // A branch starts from an older trunk commit and has one to three commits of its own.
    const base = Math.max(1, Math.floor((shape.commits / shape.branches) * (b + 1)) - 1);
    // A branch only touches files of its own, so merging it never conflicts.
    stream += chain(`refs/heads/${name}`, `:${base}`, 1 + (b % 3), shape.commits + b * 5, `Branch ${b}`, (i) => `branches/b${b}-${i}.txt`);
  }
  execFileSync("git", ["-C", dir, "fast-import", "--quiet", "--force"], {
    input: stream,
    maxBuffer: 256 * 1024 * 1024,
  });
  // Every branch has a remote branch, and some are merged into main.
  for (const name of names) {
    const tip = sh(dir, "rev-parse", `refs/heads/${name}`).trim();
    sh(dir, "update-ref", `refs/remotes/origin/${name}`, tip);
  }
  sh(dir, "reset", "-q", "--hard", "main");
  for (const name of names.filter((_, i) => i % 2 === 0).slice(0, Math.floor(shape.branches / 4))) {
    sh(dir, "merge", "-q", "--no-ff", name, "-m", `Merge ${name}`);
  }
  // Worktrees, as an agent tool leaves them.
  const root = join(dir, ".claude", "worktrees");
  mkdirSync(root, { recursive: true });
  for (let w = 0; w < shape.worktrees; w++) {
    const name = names[w] ?? `extra-${w}`;
    sh(dir, "worktree", "add", "-q", join(root, `wt-${w}`), name);
  }
}
