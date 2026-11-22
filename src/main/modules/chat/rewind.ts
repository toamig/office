import { randomUUID } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync,
  renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { IpcFailure } from "../../core/ipc";
import { runBytes } from "../../core/exec";

interface Entry { mode: string; oid: string }
type Tree = Map<string, Entry>;
interface Change { path: string; before?: Entry; after?: Entry }

const idPattern = /^[0-9a-f-]{36}$/i;
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function rewindRoot(cwd: string): string | undefined {
  if (!existsSync(cwd)) return;
  for (let root = realpathSync(cwd); ; root = dirname(root)) {
    if (existsSync(join(root, ".git"))) return root;
    if (dirname(root) === root) return;
  }
}

async function git(root: string, args: string[], options: { index?: string; input?: Buffer | string; allowFailure?: boolean } = {}): Promise<Buffer> {
  const result = await runBytes("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", ...args], {
    cwd: root, input: options.input, timeoutMs: 60_000,
    env: {
      GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined,
      GIT_INDEX_FILE: options.index, GIT_OPTIONAL_LOCKS: "0",
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

/** Scan the real index read-only for names, then write raw blobs into a separate index. */
async function workingTree(root: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "office-rewind-index-"));
  const index = join(dir, "index");
  try {
    const names = [...new Set((await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
      .toString("utf8").split("\0").filter((name) => name && !name.endsWith("/")))];
    const entries: string[] = [];
    let files: Array<{ name: string; mode: string }> = [];
    let length = 0;
    const hashFiles = async () => {
      if (!files.length) return;
      const hashes = (await git(root, ["hash-object", "-w", "--no-filters", "--", ...files.map(({ name }) => name)]))
        .toString("ascii").trim().split(/\s+/);
      entries.push(...files.map(({ name, mode }, i) => `${mode} ${hashes[i]}\t${name}\0`));
      files = [];
      length = 0;
    };
    for (const name of names) {
      const path = target(root, name);
      // Exclude entries below a replaced directory or a symlink, even if still present in the real index.
      if (parents(name).some((parent) => !stat(target(root, parent))?.isDirectory())) continue;
      const info = stat(path);
      if (info?.isSymbolicLink()) {
        const oid = (await git(root, ["hash-object", "-w", "--stdin"], { input: readlinkSync(path, { encoding: "buffer" }) }))
          .toString("ascii").trim();
        entries.push(`120000 ${oid}\t${name}\0`);
      } else if (info?.isFile()) {
        if (length + name.length > 8000) await hashFiles();
        length += 2 * name.length + 3;
        files.push({ name, mode: info.mode & 0o111 ? "100755" : "100644" });
      }
    }
    await hashFiles();
    await git(root, ["read-tree", "--empty"], { index });
    if (entries.length) await git(root, ["update-index", "-z", "--index-info"], { index, input: entries.join("") });
    return (await git(root, ["write-tree"], { index })).toString("ascii").trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function saveSnapshot(root: string, session: string, message: string): Promise<void> {
  const name = ref(session, message);
  const tree = await workingTree(root);
  const commit = (await git(root, ["commit-tree", tree, "-m", "Office file snapshot"])).toString("ascii").trim();
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

async function compare(root: string, session: string, message: string) {
  const snap = (await git(root, ["rev-parse", "--verify", `${ref(session, message)}^{tree}`], { allowFailure: true })).toString("ascii").trim();
  if (!oidPattern.test(snap)) throw new IpcFailure("no-snapshot", "This message has no file snapshot.");
  const tree = await workingTree(root);
  const [current, snapshot] = await Promise.all([entries(root, tree), entries(root, snap)]);
  return { tree, snap, changes: differences(current, snapshot) };
}

export async function previewSnapshot(root: string, session: string, message: string) {
  const { tree, snap, changes } = await compare(root, session, message);
  return {
    revision: `${tree}:${snap}`, files: changes.map(({ path, before, after }) => ({
      path, action: before && after ? "modify" as const : after ? "create" as const : "delete" as const,
    })),
  };
}

function parents(name: string): string[] {
  const parts = name.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

function apply(root: string, changes: Change[], contents: Map<string, Buffer>): void {
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
  const write = (path: string, entry: Entry) => {
    const blob = contents.get(entry.oid)!;
    if (entry.mode === "120000") symlinkSync(blob.toString("utf8"), path);
    else {
      const tmp = join(dirname(path), `.office-rewind-${randomUUID()}`);
      try {
        writeFileSync(tmp, blob, { flag: "wx", mode: entry.mode === "100755" ? 0o755 : 0o644 });
        renameSync(tmp, path);
      } finally { if (existsSync(tmp)) unlinkSync(tmp); }
    }
  };
  try {
    for (const { path, before } of changes) {
      if (!before) continue;
      const file = target(root, path);
      unlinkSync(file);
      undo.push(() => write(file, before));
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
      write(file, after);
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
  const { tree, snap, changes } = await compare(root, session, message);
  if (`${tree}:${snap}` !== expectedRevision) throw new IpcFailure("snapshot-changed", "Project files changed after the preview. Open the preview again.");
  const contents = new Map<string, Buffer>();
  for (const { before, after } of changes) {
    for (const entry of [before, after]) {
      if (entry && !contents.has(entry.oid)) contents.set(entry.oid, await git(root, ["cat-file", "blob", entry.oid]));
    }
  }
  if (changes.length) {
    if (await workingTree(root) !== tree) throw new IpcFailure("snapshot-changed", "Project files changed after the preview. Open the preview again.");
    apply(root, changes, contents);
  }
}
