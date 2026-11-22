import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync,
  renameSync, rmdirSync, symlinkSync, unlinkSync,
} from "node:fs";
import { copyFile, mkdtemp, rm, stat as fileStat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { IpcFailure } from "../../core/ipc";
import { runBytes } from "../../core/exec";

interface Entry { mode: string; oid: string }
type Tree = Map<string, Entry>;
interface Change { path: string; before?: Entry; after?: Entry }

const idPattern = /^[0-9a-f-]{36}$/i;
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const maxUntrackedBytes = 50_000_000;
const snapshotTitle = "Office file snapshot";

export function rewindRoot(cwd: string): string | undefined {
  if (!existsSync(cwd)) return;
  for (let root = realpathSync(cwd); ; root = dirname(root)) {
    if (existsSync(join(root, ".git"))) return root;
    if (dirname(root) === root) return;
  }
}

async function git(root: string, args: string[], options: { index?: string; input?: string; attributes?: string; allowFailure?: boolean } = {}): Promise<Buffer> {
  const result = await runBytes("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", ...args], {
    cwd: root, input: options.input, timeoutMs: 60_000,
    env: {
      GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined,
      GIT_INDEX_FILE: options.index, GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_SOURCE: options.attributes,
      GIT_AUTHOR_NAME: "Office", GIT_AUTHOR_EMAIL: "office@localhost",
      GIT_COMMITTER_NAME: "Office", GIT_COMMITTER_EMAIL: "office@localhost",
    },
  });
  if (result.code === 0) return result.stdout;
  if (options.allowFailure) return Buffer.alloc(0);
  throw new Error(result.stderr.trim() || `Git exited with ${result.code}`);
}

function ref(session: string, message?: string): string {
  if (!idPattern.test(session) || (message !== undefined && !idPattern.test(message))) {
    throw new IpcFailure("no-snapshot", "That message has no file snapshot.");
  }
  return `refs/office/rewind/${session}/${message ?? ""}`;
}

function target(root: string, name: string): string {
  const pieces = name.split("/");
  const file = resolve(root, name);
  const rel = relative(root, file);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) ||
    pieces.some((part) => !part || part === "." || part === ".." || /^\.git$/i.test(part.replace(/[. ]+$/, ""))) ||
    (process.platform === "win32" && /[:\\]/.test(name))) {
    throw new Error("A snapshot contains a path outside the project files.");
  }
  return file;
}

function stat(file: string) {
  try { return lstatSync(file); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return undefined;
  }
}

async function copyIndex(root: string, index: string): Promise<void> {
  const path = (await git(root, ["rev-parse", "--git-path", "index"])).toString("utf8").replace(/\r?\n$/, "");
  const source = resolve(root, path);
  try {
    const info = await fileStat(source);
    await copyFile(source, index);
    // Git uses the index timestamp to decide which cached entries might be racy.
    await utimes(index, info.atimeMs / 1000, info.mtimeMs / 1000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await git(root, ["read-tree", "--empty"], { index });
  }
}

/** Stage the working tree in a copy of the index so Git can reuse stat and clean-filter results. */
async function workingTree(root: string): Promise<{ tree: string; omitted: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "office-rewind-index-"));
  const index = join(dir, "index");
  try {
    await copyIndex(root, index);
    const names = (await git(root, ["ls-files", "-z", "--others", "--exclude-standard"], { index }))
      .toString("utf8").split("\0").filter(Boolean);
    const omitted: string[] = [];
    const excluded: string[] = [];
    for (const name of names) {
      if (name.endsWith("/")) {
        excluded.push(name.slice(0, -1));
        continue;
      }
      const info = stat(target(root, name));
      if (info?.isFile() && info.size > maxUntrackedBytes) {
        omitted.push(name);
        excluded.push(name);
      }
    }
    if (excluded.length) {
      const input = [".", ...excluded.map((name) => `:(top,literal,exclude)${name}`), ""].join("\0");
      await git(root, ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], { index, input });
    } else await git(root, ["add", "-A", "--", "."], { index });
    const tree = (await git(root, ["write-tree"], { index })).toString("ascii").trim();
    return { tree, omitted: omitted.sort() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function saveSnapshot(root: string, session: string, message: string): Promise<void> {
  const name = ref(session, message);
  const { tree, omitted } = await workingTree(root);
  const input = `${snapshotTitle}\n${omitted.length ? `\n${JSON.stringify(omitted)}\n` : ""}`;
  const commit = (await git(root, ["commit-tree", tree], { input })).toString("ascii").trim();
  await git(root, ["update-ref", name, commit]);
}

export async function dropSnapshot(root: string, session: string, message: string): Promise<void> {
  await git(root, ["update-ref", "-d", ref(session, message)]);
}

export async function pruneSnapshots(root: string, session: string, keep: string[]): Promise<void> {
  const prefix = ref(session);
  const refs = (await git(root, ["for-each-ref", "--format=%(refname)", prefix])).toString("utf8").trim().split(/\r?\n/);
  const wanted = new Set(keep.map((message) => `${prefix}${message}`));
  const remove = refs.filter((name) => name.startsWith(prefix) && !wanted.has(name));
  if (remove.length) await git(root, ["update-ref", "--stdin"], { input: remove.map((name) => `delete ${name}\n`).join("") });
}

async function entries(root: string, tree: string): Promise<Tree> {
  const raw = (await git(root, ["ls-tree", "-r", "-z", tree])).toString("utf8");
  const files: Tree = new Map();
  for (const record of raw.split("\0")) {
    const match = /^(100644|100755|120000) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    if (match?.[1] && match[2] && match[3]) files.set(match[3], { mode: match[1], oid: match[2] });
  }
  return files;
}

function differences(current: Tree, snapshot: Tree): Change[] {
  const names = new Set([...current.keys(), ...snapshot.keys()]);
  return [...names].sort().flatMap((path) => {
    const before = current.get(path);
    const after = snapshot.get(path);
    if (before?.oid === after?.oid && before?.mode === after?.mode) return [];
    return [{ path, before, after }];
  });
}

async function snapshotInfo(root: string, session: string, message: string) {
  const raw = (await git(root, ["cat-file", "commit", ref(session, message)], { allowFailure: true })).toString("utf8");
  const tree = raw.split("\n", 1)[0]?.slice(5) ?? "";
  if (!raw.startsWith("tree ") || !oidPattern.test(tree)) throw new IpcFailure("no-snapshot", "This message has no file snapshot.");
  const metadata = raw.split("\n\n")[2]?.trim();
  const paths: unknown = metadata ? JSON.parse(metadata) : [];
  if (!Array.isArray(paths) || !paths.every((path: unknown) => typeof path === "string")) throw new Error("Invalid snapshot metadata.");
  return { tree, omitted: paths as string[] };
}

function relatedToOmission(path: string, omitted: Set<string>): boolean {
  return omitted.has(path) || parents(path).some((parent) => omitted.has(parent)) ||
    [...omitted].some((name) => name.startsWith(`${path}/`));
}

async function compare(root: string, session: string, message: string) {
  const snap = await snapshotInfo(root, session, message);
  const current = await workingTree(root);
  const [currentFiles, snapshotFiles] = await Promise.all([entries(root, current.tree), entries(root, snap.tree)]);
  const omitted = new Set([...snap.omitted, ...current.omitted]);
  const paths = [...omitted].sort();
  const revision = createHash("sha256").update(JSON.stringify([current, snap])).digest("hex");
  const changes = differences(currentFiles, snapshotFiles).filter(({ path }) => !relatedToOmission(path, omitted));
  return { current, snap: snap.tree, revision, omitted: paths, changes };
}

export async function previewSnapshot(root: string, session: string, message: string) {
  const { revision, omitted, changes } = await compare(root, session, message);
  return {
    revision, omitted, files: changes.map(({ path, before, after }) => ({
      path, action: before && after ? "modify" as const : after ? "create" as const : "delete" as const,
    })),
  };
}

function parents(name: string): string[] {
  const parts = name.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

function copyEntry(source: string, destination: string): void {
  if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
  else copyFileSync(source, destination);
}

function apply(root: string, changes: Change[], checkout: string, backup: string): void {
  const remove = new Set(changes.filter(({ before }) => before).map(({ path }) => path));
  const dirsToRemove = new Set<string>();
  const protectedPath = (name: string) => new IpcFailure("protected-file", `Restore would overwrite a file outside the snapshot: ${name}`);
  const clearDir = (name: string) => {
    const path = target(root, name);
    for (const child of readdirSync(path)) {
      const nested = `${name}/${child}`;
      if (stat(target(root, nested))?.isDirectory()) clearDir(nested);
      else if (!remove.has(nested)) throw protectedPath(nested);
    }
    dirsToRemove.add(path);
  };
  for (const { path, after } of changes) {
    if (!after) continue;
    let blocked = false;
    for (const parent of parents(path)) {
      const info = stat(target(root, parent));
      if (!info || info.isDirectory()) continue;
      if (!remove.has(parent)) throw protectedPath(parent);
      blocked = true;
      break;
    }
    if (blocked) continue;
    const info = stat(target(root, path));
    if (info?.isDirectory()) clearDir(path);
    else if (info && !remove.has(path)) throw protectedPath(path);
  }

  const undo: Array<() => void> = [];
  const write = (source: string, path: string) => {
    const tmp = join(dirname(path), `.office-rewind-${randomUUID()}`);
    try {
      copyEntry(source, tmp);
      renameSync(tmp, path);
    } finally { if (stat(tmp)) unlinkSync(tmp); }
  };
  try {
    for (const { path, before } of changes) {
      if (!before) continue;
      const file = target(root, path);
      const saved = join(backup, String(undo.length));
      copyEntry(file, saved);
      unlinkSync(file);
      undo.push(() => write(saved, file));
    }
    for (const dir of dirsToRemove) {
      rmdirSync(dir);
      undo.push(() => { mkdirSync(dir); });
    }
    for (const { path, after } of changes) {
      if (!after) continue;
      for (const name of parents(path)) {
        const dir = target(root, name);
        const info = stat(dir);
        if (info?.isDirectory()) continue;
        if (info) throw protectedPath(name);
        mkdirSync(dir);
        undo.push(() => { rmdirSync(dir); });
      }
      const file = target(root, path);
      if (stat(file)) throw protectedPath(path);
      write(target(checkout, path), file);
      undo.push(() => { unlinkSync(file); });
    }
  } catch (error) {
    let failed = false;
    for (const rollback of undo.reverse()) {
      try { rollback(); } catch { failed = true; }
    }
    if (failed) throw new IpcFailure("restore-incomplete", "Restore stopped and could not undo every change. Review the project files.");
    throw error;
  }
}

export async function restoreSnapshot(root: string, session: string, message: string, expectedRevision: string): Promise<void> {
  const { current, snap, revision, changes } = await compare(root, session, message);
  const changed = () => new IpcFailure("snapshot-changed", "Project files changed after the preview. Open the preview again.");
  if (revision !== expectedRevision) throw changed();
  if (!changes.length) return;
  const dir = await mkdtemp(join(tmpdir(), "office-rewind-restore-"));
  const index = join(dir, "index");
  const checkout = join(dir, "checkout");
  const backup = join(dir, "backup");
  try {
    mkdirSync(checkout);
    mkdirSync(backup);
    const paths = changes.filter(({ after }) => after).map(({ path }) => path);
    for (const path of paths) target(checkout, path);
    if (paths.length) {
      await git(root, ["read-tree", snap], { index });
      const prefix = `${checkout.replace(/\\/g, "/")}/`;
      await git(root, ["checkout-index", "--ignore-skip-worktree-bits", `--prefix=${prefix}`, "-z", "--stdin"], {
        index, attributes: snap, input: `${paths.join("\0")}\0`,
      });
    }
    const latest = await workingTree(root);
    if (latest.tree !== current.tree || latest.omitted.join("\0") !== current.omitted.join("\0")) throw changed();
    apply(root, changes, checkout, backup);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
