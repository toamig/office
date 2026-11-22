import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import console from "node:console";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { setTimeout as pause } from "node:timers/promises";
import { TextDecoder } from "node:util";

const [hook, rootArg, mode, messageFile] = process.argv.slice(2);
const repo = process.cwd();
const root = resolve(rootArg || repo);
const normalize = (path) => path.replaceAll("\\", "/");
const env = { ...process.env };
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"])
  delete env[key];
env.GIT_TERMINAL_PROMPT = "0";
const execute = (command, args, cwd, options = {}) =>
  spawnSync(command, args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120_000, ...options });
const git = (args, cwd = repo, clean = false) =>
  execute("git", ["--literal-pathspecs", ...args], cwd, clean ? { env } : {});
const stdout = (result) => result.stdout?.toString("utf8") ?? "";
const staged = () => stdout(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]))
  .split("\0").filter(Boolean);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function configuredPack(dir) {
  for (const folder of ["Common", "Rules"]) {
    const file = join(dir, folder, "rules.json");
    if (existsSync(file)) return readJson(file);
  }
  return null;
}

function commandArgs(text) {
  const args = [];
  const pattern = /\s*((?:"[^"]*"|'[^']*'|[^\s"']+)+)(?=\s|$)/y;
  while (pattern.lastIndex < text.trimEnd().length) {
    const part = pattern.exec(text)?.[1];
    if (!part) throw new Error("Invalid quoting in rule pack command.");
    args.push(part.replace(/"([^"]*)"|'([^']*)'/g, (_match, double, single) => double ?? single));
  }
  return args;
}

function runPackCommand(text, cwd) {
  const [command, ...args] = commandArgs(text);
  return execute(command, args, cwd, { env });
}

function addedLines(path) {
  const diff = stdout(git(["diff", "--cached", "--unified=0", "--no-color", "--no-ext-diff", "--no-renames", "--", path]));
  const added = new Set();
  let number;
  for (const line of diff.split("\n")) {
    const start = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (start) number = Number(start[1]);
    else if (number !== undefined) {
      if (line.startsWith("+")) added.add(number++);
      else if (line.startsWith(" ")) number++;
    }
  }
  return added;
}

function proseDashLines(text, added) {
  const found = [];
  let fence;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
    } else if (!fence && added.has(index + 1) && /[\u2013\u2014]/.test(line)) found.push(index + 1);
  }
  return found;
}

function stagedProblems(paths, checks) {
  const failures = [];
  for (const path of paths) {
    const blob = git(["show", `:${path}`]);
    const bytes = blob.stdout;
    if (blob.status !== 0 || !bytes || bytes.includes(0)) continue;
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { continue; }
    if (checks.includes("utf8-no-bom") && bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])))
      failures.push(`${path}: remove the UTF-8 byte order mark`);
    if (checks.includes("lf") && text.includes("\r\n")) failures.push(`${path}: use LF line endings`);
    if (checks.includes("no-dash-in-added-prose") && /\.md$/i.test(path)) {
      for (const line of proseDashLines(text, addedLines(path)))
        failures.push(`${path}:${line}: replace the dash in the added prose`);
    }
  }
  return failures;
}

function safeChild(parent, child) {
  const result = resolve(parent, child);
  const rel = relative(parent, result);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return null;
  return result;
}

function checkout(dir, snapshot) {
  mkdirSync(snapshot, { recursive: true });
  const same = process.platform === "win32"
    ? resolve(dir).toLowerCase() === resolve(repo).toLowerCase()
    : resolve(dir) === resolve(repo);
  const result = git(["checkout-index", "--all", `--prefix=${normalize(snapshot)}/`], dir, !same);
  if (result.status !== 0) throw new Error(result.stderr?.toString("utf8").trim() || "Could not read the Git index.");
}

function packProblems(paths, tools) {
  if (!tools?.validate && !tools?.reindexCheck) return [];
  const snapshot = mkdtempSync(join(tmpdir(), "office-brain-index-"));
  try {
    checkout(root, snapshot);
    const hub = readJson(join(snapshot, "brain.repos.json"));
    for (const entry of hub?.repos ?? []) {
      if (typeof entry?.folder !== "string") continue;
      const from = safeChild(root, entry.folder);
      const to = safeChild(snapshot, entry.folder);
      if (from && to && existsSync(join(from, ".git"))) checkout(from, to);
    }
    const prefix = normalize(relative(root, repo));
    const stagedPaths = paths.map((file) => prefix ? `${prefix}/${file}` : file);
    const errors = [];
    for (const name of ["validate", "reindexCheck"]) {
      if (typeof tools[name] !== "string") continue;
      const result = runPackCommand(tools[name], snapshot);
      const report = stdout(result) + (result.stderr?.toString("utf8") ?? "");
      for (const raw of report.split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const line = normalize(raw).replaceAll(normalize(snapshot) + "/", "");
        if (line.startsWith("ERROR ") && stagedPaths.some((file) =>
          line.startsWith(`ERROR ${file}:`) || line === `ERROR ${file}`)) errors.push(line.slice(6));
        else console.log(raw);
      }
      if (result.error) console.log(`Office could not run ${name}: ${result.error.message}`);
    }
    return errors;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

function stripTrailer(path) {
  const text = readFileSync(path).toString("latin1");
  const cleaned = text.replace(/^[ \t]*Co-Authored-By:[^\r\n]*(?:\r?\n|$)/gim, "");
  if (cleaned !== text) writeFileSync(path, Buffer.from(cleaned, "latin1"));
}

async function syncAfterCommit(pack) {
  const dir = stdout(git(["rev-parse", "--absolute-git-dir"], root, true)).trim();
  if (!dir) return;
  const lock = join(dir, "office-post-commit.lock");
  for (let attempt = 0; attempt < 120; attempt++) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== "EEXIST" || attempt === 119) return;
      await pause(1000);
    }
  }
  try {
    if (typeof pack?.tools?.sync === "string") runPackCommand(pack.tools.sync, root);
    else if (git(["rev-parse", "--abbrev-ref", "@{u}"], repo, true).status === 0)
      git(["push", "--quiet"], repo, true);
  } finally {
    rmdirSync(lock);
  }
}

try {
  const pack = configuredPack(root);
  const checks = pack?.checks?.staged ?? ["utf8-no-bom", "lf"];
  if (hook === "commit-msg" && pack?.checks?.commitMsg?.includes("strip-co-authored-by") && messageFile)
    stripTrailer(messageFile);
  else if (hook === "post-commit" && mode === "brain" && process.env.OFFICE_VAULT_WRITER !== "1")
    await syncAfterCommit(pack);
  else if (hook === "pre-commit" || hook === "writer") {
    const paths = staged().filter((file) => hook !== "writer" || file === messageFile);
    const findings = stagedProblems(paths, checks);
    if (hook === "pre-commit" && mode === "brain" && paths.length) {
      try { findings.push(...packProblems(paths, pack?.tools)); }
      catch (error) { console.log(`Office could not check the Brain: ${error.message}`); }
    }
    for (const issue of findings) console.error(`ERROR ${issue}`);
    if (findings.length) process.exitCode = 1;
  }
} catch (error) {
  console.error(`Office rules: ${error.message}`);
  if (hook === "writer") process.exitCode = 1;
}
