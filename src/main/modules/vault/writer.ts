import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import type { WriteResult } from "../../../shared/models";
import { writeTextFile } from "../../core/settings";
import { git } from "../git/run";
import { operationInProgress } from "../git/sync";
import { appendToSection, formatWaitingLine, removeWaitingLine } from "./openitems";
import { runValidate } from "./health";

export class VaultWriteError extends Error {
  constructor(
    readonly code: "pull-failed" | "not-found" | "commit-failed" | "no-repo" | "dirty" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

export interface WriterWarning {
  kind: "push-failed" | "write-failed" | "validate";
  message: string;
}

export interface VaultWriterDeps {
  /** Hub root for `brain-hub` vaults, so validate can run after a write; null otherwise. */
  hubRoot: () => string | null;
  onWarning: (warning: WriterWarning) => void;
  today?: () => string;
}

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? "";

/**
 * Every vault write: pull --rebase --autostash, edit the one file, commit only that file, push.
 * A failed pull aborts the write; a failed push keeps the commit and raises a warning.
 */
export class VaultWriter {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: VaultWriterDeps) {}

  today(): string {
    if (this.deps.today) return this.deps.today();
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Serialises writes so two edits never race on the same repo. */
  edit(
    file: string,
    message: string,
    transform: (content: string) => string | null,
    initial?: () => string,
  ): Promise<WriteResult> {
    const next = this.chain.then(() => this.doEdit(file, message, transform, initial));
    this.chain = next.catch(() => undefined);
    return next;
  }

  removeWaiting(file: string, raw: string, heading: string, message: string): Promise<WriteResult> {
    return this.edit(file, message, (c) => removeWaitingLine(c, raw, heading));
  }

  addWaiting(
    file: string,
    heading: string,
    text: string,
    source: string | undefined,
    message: string,
    initial?: () => string,
  ): Promise<WriteResult> {
    const line = formatWaitingLine(this.today(), text, source);
    return this.edit(file, message, (c) => appendToSection(c, heading, line), initial);
  }

  addToSection(
    file: string,
    heading: string,
    line: string,
    message: string,
    initial?: () => string,
  ): Promise<WriteResult> {
    return this.edit(file, message, (c) => appendToSection(c, heading, line), initial);
  }

  private async doEdit(
    file: string,
    message: string,
    transform: (content: string) => string | null,
    initial?: () => string,
  ): Promise<WriteResult> {
    if (/co-authored-by/i.test(message)) {
      throw new VaultWriteError(
        "commit-failed",
        "Commit messages never carry a Co-Authored-By trailer",
      );
    }
    const dir = dirname(file);
    const top = await git(dir, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) throw new VaultWriteError("no-repo", `${file} is not inside a git repo`);
    const repo = top.stdout.trim();

    const rel = relative(repo, file).replace(/\\/g, "/");
    // An edit of the owner's own, not yet committed, is never mixed into an automatic commit.
    const dirty = await git(repo, ["status", "--porcelain", "--", rel]);
    if (dirty.stdout.trim() !== "") {
      const why = `${rel} has changes that are not committed yet; commit or discard them first`;
      this.deps.onWarning({ kind: "write-failed", message: why });
      throw new VaultWriteError("dirty", why);
    }

    const hasUpstream = (await git(repo, ["rev-parse", "--abbrev-ref", "@{u}"])).code === 0;
    if (hasUpstream) {
      const pull = await git(repo, ["pull", "--rebase", "--autostash", "--quiet"], {
        timeoutMs: 60_000,
      });
      if (pull.code !== 0) {
        if (await operationInProgress(repo)) await git(repo, ["rebase", "--abort"]);
        const why = `Could not update ${basename(repo)} before writing: ${firstLine(pull.stderr)}`;
        this.deps.onWarning({ kind: "write-failed", message: why });
        throw new VaultWriteError("pull-failed", why);
      }
      // `pull --autostash` exits 0 even when putting the stash back conflicts; check for unmerged files.
      const unmerged = await git(repo, ["diff", "--name-only", "--diff-filter=U"]);
      if (unmerged.stdout.trim() !== "") {
        const files = unmerged.stdout.trim().split(/\r?\n/).join(", ");
        // Git keeps the stash entry when it conflicts, so the owner's changes are not lost.
        await git(repo, ["reset", "--hard", "HEAD"]);
        const why = `Could not write: your uncommitted changes in ${basename(repo)} conflict with the update (${files}). They are kept in "git stash"; nothing was written`;
        this.deps.onWarning({ kind: "write-failed", message: why });
        throw new VaultWriteError("conflict", why);
      }
    }

    let before: string;
    if (existsSync(file)) before = readFileSync(file, "utf8");
    else if (initial) before = initial();
    else throw new VaultWriteError("not-found", `${rel} does not exist yet`);
    const after = transform(before);
    if (after === null)
      throw new VaultWriteError("not-found", "That line is no longer in the file");
    if (after === before) return { committed: false, pushed: false, validateErrors: [] };
    writeTextFile(file, after);

    const add = await git(repo, ["add", "--", rel]);
    const commit =
      add.code === 0
        ? await git(repo, ["commit", "-m", message, "--", rel], { timeoutMs: 120_000 })
        : add;
    if (commit.code !== 0) {
      throw new VaultWriteError(
        "commit-failed",
        `Commit failed: ${firstLine(commit.stderr || commit.stdout)}`,
      );
    }

    let pushed = false;
    let pushError: string | undefined;
    if (hasUpstream) {
      const push = await git(repo, ["push", "--quiet"], { timeoutMs: 60_000 });
      pushed = push.code === 0;
      if (!pushed) {
        pushError = firstLine(push.stderr);
        this.deps.onWarning({
          kind: "push-failed",
          message: `Saved in ${basename(repo)} but not pushed (${pushError}); the next sync retries`,
        });
      }
    }

    const validateErrors = await this.validate();
    return { committed: true, pushed, ...(pushError ? { pushError } : {}), validateErrors };
  }

  private async validate(): Promise<string[]> {
    const root = this.deps.hubRoot();
    if (!root) return [];
    const result = await runValidate(root);
    if (result.ran && !result.ok) {
      this.deps.onWarning({
        kind: "validate",
        message: `brain validate: ${result.errors.join("; ")}`,
      });
    }
    return result.errors;
  }
}
