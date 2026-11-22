import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { writeRawFile, writeTextFile } from "../../core/settings";
import { git, gitOk } from "../git/run";

const added = new Set(["pre-commit", "commit-msg", "post-commit"]);
const recordName = "office-hooks.json";
const HookRecord = z.object({
  previous: z.array(z.string()), original: z.string(), script: z.string(),
  root: z.string(), mode: z.enum(["brain", "code"]), names: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
});
type HookRecord = z.infer<typeof HookRecord>;
const comparePath = (a: string, b: string) => {
  const normalize = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  return normalize(a) === normalize(b);
};
const quote = (value: string) => "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";

function wrapper(name: string, record: HookRecord): string {
  const prior = quote(join(record.original, name));
  const check = `node "$office_check" ${name} ${quote(record.root)} ${record.mode} "$@"`;
  const run = name === "post-commit" ? `${check} </dev/null >/dev/null 2>&1 &\nexit 0` : check;
  if (!added.has(name) || (name === "post-commit" && record.mode === "code"))
    return `#!/bin/sh\nif [ -x ${prior} ]; then exec ${prior} "$@"; fi\nexit 0\n`;
  return [
    "#!/bin/sh",
    `if [ -x ${prior} ]; then ${prior} "$@" || exit $?; fi`,
    "# office:begin",
    `office_check=${quote(record.script)}`,
    '[ -f "$office_check" ] && command -v node >/dev/null 2>&1 || exit 0',
    run,
    "# office:end",
    "",
  ].join("\n");
}

type Location = { folder: string; active: string; previous: string[]; record?: HookRecord };

export class GitRuleHooks {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly script: string) {}

  private async location(repo: string): Promise<Location> {
    const [top, common, active, local] = await Promise.all([
      gitOk(repo, ["rev-parse", "--show-toplevel"]),
      gitOk(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      gitOk(repo, ["rev-parse", "--path-format=absolute", "--git-path", "hooks"]),
      git(repo, ["config", "--local", "--no-includes", "--null", "--get-all", "core.hooksPath"]),
    ]);
    if (!comparePath(top.trim(), repo)) throw new Error("Choose the root of a Git repository.");
    const folder = join(common.trim(), "office-rule-hooks");
    const current = isAbsolute(active.trim()) ? active.trim() : resolve(repo, active.trim());
    const previous = local.stdout.split("\0").slice(0, -1);
    let record: HookRecord | undefined;
    if (existsSync(join(folder, recordName)))
      record = HookRecord.parse(JSON.parse(readFileSync(join(folder, recordName), "utf8")));
    return { folder, active: current, previous, record };
  }

  async installed(repo: string): Promise<boolean> {
    try {
      const { folder, active, record } = await this.location(repo);
      return !!record && comparePath(folder, active);
    } catch { return false; }
  }

  configure(repo: string, root: string, mode: "brain" | "code", enabled: boolean): Promise<void> {
    const task = this.queue.then(async () => {
      if (enabled) await this.install(repo, root, mode);
      else await this.remove(repo);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async install(repo: string, root: string, mode: "brain" | "code"): Promise<void> {
    const { folder, active, previous, record } = await this.location(repo);
    if (record && comparePath(folder, active)) {
      if (record.root !== root || record.mode !== mode)
        throw new Error("Remove this repository's existing Office rules before changing their scope.");
      return;
    }
    if (existsSync(folder)) throw new Error("The Office hooks folder already exists. Review it before installing.");
    const extra = existsSync(active) ? readdirSync(active).filter((name) => /^[a-z][a-z0-9-]*$/.test(name)) : [];
    const names = [...added].filter((name) => name !== "post-commit" || mode === "brain");
    const next: HookRecord = { original: active, previous, script: this.script, root, mode, names: [...new Set([...names, ...extra])] };
    mkdirSync(folder);
    const written: string[] = [];
    try {
      for (const name of next.names) {
        const file = join(folder, name);
        writeRawFile(file, wrapper(name, next));
        written.push(file);
        chmodSync(file, 0o755);
      }
      const manifest = join(folder, recordName);
      writeTextFile(manifest, JSON.stringify(next, null, 2) + "\n");
      written.push(manifest);
      await gitOk(repo, ["config", "--local", "--replace-all", "core.hooksPath", folder]);
    } catch (error) {
      for (const file of written) unlinkSync(file);
      rmdirSync(folder);
      throw error;
    }
  }

  private async remove(repo: string): Promise<void> {
    const { folder, active, record } = await this.location(repo);
    if (!record) return;
    if (!comparePath(folder, active)) throw new Error("The repository's hook path changed after installation.");
    for (const name of record.names) {
      const file = join(folder, name);
      if (existsSync(file) && readFileSync(file, "utf8") !== wrapper(name, record))
        throw new Error(`${name} was changed inside the Office hooks folder. Preserve those edits before removing Office rules.`);
    }
    if (record.previous.length) {
      await gitOk(repo, ["config", "--local", "--replace-all", "core.hooksPath", record.previous[0]!]);
      for (const value of record.previous.slice(1)) await gitOk(repo, ["config", "--local", "--add", "core.hooksPath", value]);
    } else await gitOk(repo, ["config", "--local", "--unset-all", "core.hooksPath"]);
    for (const name of [...record.names, recordName]) {
      const file = join(folder, name);
      if (existsSync(file)) unlinkSync(file);
    }
    if (!readdirSync(folder).length) rmdirSync(folder);
  }
}
