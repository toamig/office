// One-off: writes the owner's workspace config into the workspace repo (the brain) and commits it.
// The project table, roles and pipelines are read from the plan note at run time, so no owner data
// lives in this public repo.
//
//   node --experimental-strip-types scripts/seed-owner.mjs \
//     --plan <Implementation.md> --root <workspaceRoot> --projects <projectsRoot> [--config Office/workspace.json]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const planPath = arg("plan");
const root = arg("root");
const projectsRoot = arg("projects");
const configRel = arg("config", "Office/workspace.json");
if (!planPath || !root || !projectsRoot) {
  console.error("usage: seed-owner.mjs --plan <file> --root <dir> --projects <dir> [--config <rel>]");
  process.exit(2);
}

const plan = readFileSync(planPath, "utf8").replace(/\r\n/g, "\n");
const section = plan.slice(plan.indexOf("### 5.3"), plan.indexOf("### 5.4"));

const projects = [];
const dropped = [];
for (const line of section.split("\n")) {
  if (!line.startsWith("| ") || line.startsWith("| id ") || line.startsWith("|---")) continue;
  const [id, name, path, vault, group] = line.split("|").slice(1, 6).map((c) => c.trim());
  if (!existsSync(resolve(projectsRoot, path))) {
    dropped.push(`${id} (${path})`);
    continue;
  }
  projects.push({
    id,
    name,
    path,
    vault,
    group,
    pinned: ["lucky-flock", "obrajusta", "office"].includes(id),
    archived: false,
  });
}

const jsonStart = section.indexOf("```json") + "```json".length;
const jsonEnd = section.indexOf("```", jsonStart);
const rolesAndPipelines = JSON.parse(`{${section.slice(jsonStart, jsonEnd)}}`);
const urgent = JSON.parse(/`notifications\.urgent` seed: `(\[.*?\])`/.exec(section)[1]);

const config = {
  version: 1,
  vault: { kind: "brain-hub", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
  projects,
  roles: rolesAndPipelines.roles,
  pipelines: rolesAndPipelines.pipelines,
  notifications: { urgent, mutedProjects: [] },
  automations: [],
  archiveAfterDays: 7,
  briefTime: "08:00",
};

const { Workspace } = await import(pathToFileURL(resolve(import.meta.dirname, "../src/shared/schemas.ts")).href);
const parsed = Workspace.parse(config);

const target = join(root, configRel);
const repoDir = join(root, configRel.split("/")[0]);
const git = (...args) => execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });

try {
  git("pull", "--rebase", "--autostash");
} catch (err) {
  console.error(`pull failed, aborting: ${err.message}`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8" });
git("add", "--", configRel.split("/").slice(1).join("/"));
try {
  git("commit", "-m", "Office: add the workspace config");
} catch {
  console.log("nothing to commit (file unchanged)");
}
try {
  git("push");
} catch (err) {
  console.error(`push failed (the commit is kept): ${err.message}`);
}
console.log(`wrote ${target} with ${projects.length} projects`);
if (dropped.length) console.log(`dropped (folder missing): ${dropped.join(", ")}`);
