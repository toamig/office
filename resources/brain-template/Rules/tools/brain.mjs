import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import console from "node:console";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { TextDecoder } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const option = process.argv[2];
const pack = JSON.parse(readFileSync(join(root, "Rules/rules.json"), "utf8"));
const types = new Set(["index", "contract", "reference", "patterns", "architecture", "overview",
  "openitems", "decisions", "conventions", "shared", "spec", "roadmap", "design", "brand"]);
const ignored = new Set(["AGENTS.md", "CLAUDE.md", "README.md"]);
const begin = "<!-- BEGIN GENERATED -->";
const end = "<!-- END GENERATED -->";
const fence = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/;
const sort = (a, b) => a.localeCompare(b, "en");
const posix = (path) => path.replaceAll("\\", "/");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "Archive") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

function scalar(text) {
  const value = text.trim();
  if (value.startsWith('"')) return JSON.parse(value);
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  if (/:\s|:$/.test(value)) throw new Error("Quote values containing a colon followed by a space.");
  return value;
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error("Missing YAML frontmatter");
  const out = Object.create(null);
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const field = /^([a-z_]+):(?:\s+(.*))?$/.exec(line);
    if (!field || Object.hasOwn(out, field[1])) throw new Error("Invalid or repeated frontmatter field");
    const [, key, value = ""] = field;
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).match(/"[^"]*"|'(?:[^']|'')*'|[^,]+/g) ?? [];
      out[key] = items.filter((item) => item.trim()).map(scalar);
    } else if (!value || /^[>|][+-]?$/.test(value)) {
      const nested = [];
      while (/^\s+\S/.test(lines[index + 1] ?? "")) nested.push(lines[++index].trim());
      out[key] = value ? nested.join(value.startsWith(">") ? " " : "\n")
        : nested.map((item) => {
          if (!item.startsWith("- ")) throw new Error(`Invalid list for ${key}`);
          return scalar(item.slice(2));
        });
    } else out[key] = scalar(value);
  }
  return { data: out, body: text.slice(match[0].length) };
}

function prose(text) {
  let open;
  return text.split(/\r?\n/).map((line) => {
    const marker = fence.exec(line)?.[1];
    if (marker) {
      if (!open) open = marker;
      else if (marker[0] === open[0] && marker.length >= open.length && line.trim() === marker) open = undefined;
      return "";
    }
    return open ? "" : line.replace(/`+[^`]*`+/g, (span) => span.includes("[[") ? "" : span);
  }).join("\n");
}

function load() {
  return walk(root).filter((path) => /\.md$/i.test(path)).map((path) => {
    const text = readFileSync(path, "utf8");
    const name = posix(relative(root, path));
    if (ignored.has(basename(name)) && !text.startsWith("---")) return { name, path, text, body: text };
    try { return { name, path, text, ...frontmatter(text) }; }
    catch (error) { return { name, path, text, error: error.message }; }
  }).sort((a, b) => sort(a.name, b.name));
}

const headingKey = (text) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
const scopeAt = process.argv.indexOf("--scope");
const scoped = scopeAt < 0 ? "" : posix(relative(root, resolve(root, process.argv[scopeAt + 1] ?? "")));
const inScope = (path) => !scoped || path === scoped || path.startsWith(scoped + "/");

function validate(notes) {
  let errors = 0;
  let warnings = 0;
  const index = new Map(notes.map((note) => [note.name, note]));
  const docs = notes.filter((note) => inScope(note.name));
  const warn = (name, text) => { warnings++; console.log(`warn  ${name}: ${text}`); };
  let coreLines = 0;
  for (const note of docs) {
    const error = (text) => { errors++; console.log(`ERROR ${note.name}: ${text}`); };
    if (note.error) { error(note.error); continue; }
    const data = note.data;
    if (data) {
      for (const field of Object.keys(data)) {
        if (!["type", "domain", "summary", "project", "tags", "answers", "authority", "derived_from"].includes(field))
          error(`Unknown field ${field}`);
      }
      if (!types.has(data.type)) error("Unknown or missing type");
      if (!pack.domains.includes(data.domain)) error(`Unknown or missing domain ${data.domain ?? ""}`);
      if (typeof data.summary !== "string" || !data.summary.trim() || data.summary.length > 160) error("Expected a summary up to 160 characters");
      if (!Array.isArray(data.answers) || data.answers.length < 1 || data.answers.length > 5 || data.answers.some((item) => !item))
        error("Expected one to five questions in answers");
      if (!Array.isArray(data.tags) || data.tags.length > 6) error("Expected up to six tags");
      else for (const tag of data.tags) if (!pack.tags.includes(tag)) error(`Unknown tag ${tag}`);
      if (!["own", "derived"].includes(data.authority)) error("Expected authority own or derived");
      if (data.authority === "derived" && !data.derived_from?.length) error("A derived note needs derived_from");
      if (data.authority === "own" && data.derived_from) error("Only derived notes carry derived_from");
      if (data.type === "index" && !marked(note.text)) error("Expected one generated block");
      const lines = note.text.split("\n").length;
      const limit = ["openitems", "decisions"].includes(data.type) ? 900 : 1200;
      if (lines > limit && !["reference", "index"].includes(data.type)) warn(note.name, `Review this note for a split (${lines} lines)`);
    }
    if (pack.load.some((entry) => entry.file === note.name)) {
      const count = note.body.split("\n").length;
      coreLines += count;
      if (count > 80) warn(note.name, `Core text is ${count} lines. Aim for at most 80.`);
    }
    for (const [, path, anchor] of prose(note.body).matchAll(/\[\[([^|#\]]*)(?:#([^|\]]+))?(?:\|[^\]]*)?\]\]/g)) {
      const target = index.get(path ? `${path.replace(/\\$/, "").trim().replace(/\.md$/i, "")}.md` : note.name);
      if (!target) error(`Link target is missing: ${path}`);
      else if (anchor && ![...prose(target.body ?? target.text).matchAll(/^#{1,6}\s+(.+)$/gm)]
        .some(([, title]) => headingKey(title) === headingKey(anchor.replace(/\\$/, "")))) error(`Link heading is missing: ${path}#${anchor}`);
    }
    if (Array.isArray(data?.derived_from)) {
      for (const source of data.derived_from)
        if (!index.has(`${source.split("#", 1)[0].replace(/\.md$/i, "")}.md`)) error(`Missing derived source: ${source}`);
    }
  }
  if (coreLines > 200) warn("Rules/rules.json", `Loaded Core text is ${coreLines} lines. Aim for at most 200.`);
  console.log(`folder: ${docs.length} files, ${errors} errors, ${warnings} warnings`);
  return errors ? 1 : 0;
}

function marked(text) {
  const first = text.indexOf(begin);
  const last = text.indexOf(end);
  return first >= 0 && last > first && first === text.lastIndexOf(begin) && last === text.lastIndexOf(end);
}

function routerTable(rows) {
  if (!rows.length) return "";
  return ["", "| Note | Type | Purpose |", "| --- | --- | --- |", ...rows.map(({ name, data }) =>
    `| [[${name.replace(/\.md$/i, "")}]] | ${data.type} | ${data.summary.replaceAll("|", "\\|").replace(/\s+/g, " ")} |`), "", ""].join("\n");
}

function reindex(notes, check) {
  const groups = new Map();
  for (const note of notes.filter((item) => item.data)) {
    const dir = posix(dirname(note.name));
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(note);
  }
  const routes = [];
  const changes = [];
  let invalid = false;
  for (const [dir, members] of groups) {
    if (dir === ".") continue;
    const route = members.find((item) => item.name === `${dir}/_index.md`);
    if (!route) continue;
    changes.push([route, members.filter((item) => item !== route)]);
    let privateNotes = false;
    try { privateNotes = JSON.parse(readFileSync(join(root, dir, "brain.json"), "utf8")).private === true; }
    catch { /* A notes folder need not declare privacy. */ }
    if (!privateNotes) routes.push(route);
  }
  const top = groups.get(".") ?? [];
  const rootIndex = top.find((item) => item.name === "_index.md");
  if (rootIndex) changes.push([rootIndex, [...routes, ...top.filter((item) => item !== rootIndex)]]);
  let count = 0;
  for (const [router, rows] of changes) {
    if (!inScope(router.name)) continue;
    if (!marked(router.text)) { console.log(`ERROR ${router.name}: expected one generated block`); invalid = true; continue; }
    const lineEnd = router.text.includes("\r\n") ? "\r\n" : "\n";
    const next = router.text.slice(0, router.text.indexOf(begin) + begin.length) + lineEnd
      + routerTable(rows.filter((row) => typeof row.data.summary === "string")).replaceAll("\n", lineEnd)
      + router.text.slice(router.text.indexOf(end));
    if (next === router.text) continue;
    count++;
    if (check) console.log(`ERROR ${router.name}: generated router is out of date`);
    else { writeFileSync(router.path, next, "utf8"); console.log(`reindexed ${router.name}`); }
  }
  console.log(`${count} router(s) ${check ? "out of date" : "rewritten"}`);
  return invalid || (check && count > 0) ? 1 : 0;
}

function scan() {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const signals = [
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["API key", /\b(?:sk-ant-|sk-proj-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{16,}/],
    ["credential in URL", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@]+:[^\s@]+@/],
    ["secret assignment", /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)\s*[:=]\s*["']?[A-Za-z0-9_+/-]{16,}/],
  ];
  let hits = 0;
  for (const file of walk(root)) {
    const name = posix(relative(root, file));
    if (!inScope(name) || name === "Rules/tools/brain.mjs") continue;
    const contents = readFileSync(file);
    if (contents.length > 2_000_000 || contents.includes(0)) continue;
    let text;
    try { text = decoder.decode(contents); } catch { continue; }
    for (const [index, line] of text.split("\n").entries()) {
      for (const [label, pattern] of signals) {
        if (!pattern.test(line)) continue;
        hits++;
        console.log(`LEAK ${name}:${index + 1} ${label}`);
      }
    }
  }
  console.log(`${hits} potential leak(s)`);
  return hits ? 1 : 0;
}

if (scopeAt >= 0 && (!process.argv[scopeAt + 1] || scoped === ".." || scoped.startsWith(".." + sep))) {
  console.error("The scope must be inside the Brain.");
  process.exitCode = 2;
} else if (option === "validate") process.exitCode = validate(load());
else if (option === "reindex") process.exitCode = reindex(load(), process.argv.includes("--check"));
else if (option === "scan") process.exitCode = scan();
else { console.error("Usage: node Rules/tools/brain.mjs validate|reindex|scan [--check] [--scope folder]"); process.exitCode = 2; }
