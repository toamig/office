// `npm run test:affected [-- --since <commit>]`: typecheck, lint, the unit tests related to what changed, and
// the e2e specs of the areas touched (tests/impact.json). Defaults to everything changed since HEAD
// (staged, unstaged and new files). The full suites are `npm test`, `npm run e2e:web` and `npm run e2e`.
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { selectSpecs } from "./impact.mjs";

const repo = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : "HEAD";
const git = (...a) =>
  execFileSync("git", a, { cwd: repo, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const changed = [
  ...new Set([
    ...git("diff", "--name-only", since),
    ...git("ls-files", "-o", "--exclude-standard"),
  ]),
];
const win = process.platform === "win32";
const run = (label, cmd, a) => {
  console.log(`\n> ${label}`);
  const r = spawnSync(cmd, a, { cwd: repo, stdio: "inherit", shell: win });
  if (r.status !== 0) {
    console.error(`\n${label} failed`);
    process.exit(r.status ?? 1);
  }
};

if (changed.length === 0) {
  console.log("Nothing changed since", since);
  process.exit(0);
}
console.log(`Changed since ${since}: ${changed.length} file(s)`);
const pick = selectSpecs(changed);
if (pick.unmapped.length > 0) {
  console.error(`No area in tests/impact.json covers: ${pick.unmapped.join(", ")}`);
  process.exit(1);
}

run("typecheck", "npm", ["run", "typecheck"]);
run("lint", "npm", ["run", "lint"]);
const related = changed.filter(
  (f) => /\.(ts|tsx|mjs)$/.test(f) && /^(src|tests\/unit|scripts)\//.test(f.replaceAll("\\", "/")),
);
if (related.length > 0)
  run("related unit tests", "npx", ["vitest", "related", "--run", "--passWithNoTests", ...related]);

const touchesApp = changed.some((f) => /^(src|vite\.|package\.json)/.test(f.replaceAll("\\", "/")));
if (pick.fullWeb || pick.web.length > 0) {
  if (touchesApp) run("build the web interface and host", "npm", ["run", "build:web"]);
  run(pick.fullWeb ? "e2e:web (everything)" : `e2e:web (${pick.web.length} spec files)`, "npx", [
    "playwright",
    "test",
    "-c",
    "playwright.web.config.ts",
    ...(pick.fullWeb ? [] : pick.web),
  ]);
}
if (pick.fullElectron || pick.electron.length > 0) {
  if (touchesApp) run("build the desktop app", "npm", ["run", "build"]);
  run(
    pick.fullElectron
      ? "e2e (everything, Electron)"
      : `e2e (${pick.electron.length} Electron spec files)`,
    "npx",
    ["playwright", "test", ...(pick.fullElectron ? [] : pick.electron)],
  );
}
console.log(
  "\nAffected checks passed. Full suites: npm test, npm run e2e:web, npm run e2e (and dist before an install).",
);
