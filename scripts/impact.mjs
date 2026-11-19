// Which e2e specs a change could affect (plan 1, rule 3). The map is tests/impact.json; this file is the logic
// that reads it, shared by `npm run test:affected` and the unit test that keeps the map complete.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");

export const loadImpact = () =>
  JSON.parse(readFileSync(join(repo, "tests", "impact.json"), "utf8"));

const norm = (path) => path.replaceAll("\\", "/").replace(/^\.\//, "");
const under = (file, prefix) => file === prefix || file.startsWith(`${prefix}/`);

/** The longest key of `areas` that is a prefix of the file, or null. */
export function areaOf(file, impact) {
  let best = null;
  for (const key of Object.keys(impact.areas)) {
    if (under(file, key) && (best === null || key.length > best.length)) best = key;
  }
  return best;
}

/**
 * What to run for a list of changed files: the specs of the areas touched, or the whole run of a project when a
 * file that touches everything changed. A changed spec runs itself. A file no key covers is reported, never skipped.
 */
export function selectSpecs(changed, impact = loadImpact()) {
  const web = new Set();
  const electron = new Set();
  const unmapped = [];
  let fullWeb = false;
  let fullElectron = false;
  for (const raw of changed) {
    const file = norm(raw);
    if (impact.everything.web.some((p) => under(file, p))) fullWeb = true;
    if (impact.everything.electron.some((p) => under(file, p))) fullElectron = true;
    if (/^tests\/web\/.*\.spec\.ts$/.test(file)) web.add(file);
    if (/^tests\/e2e\/.*\.spec\.ts$/.test(file)) electron.add(file);
    const area = areaOf(file, impact);
    if (area) {
      for (const spec of impact.areas[area].web ?? []) web.add(spec);
      for (const spec of impact.areas[area].electron ?? []) electron.add(spec);
    } else if (
      !impact.everything.web.some((p) => under(file, p)) &&
      !impact.everything.electron.some((p) => under(file, p)) &&
      !/^tests\/(web|e2e)\/.*\.spec\.ts$/.test(file)
    ) {
      unmapped.push(file);
    }
  }
  return { web: [...web].sort(), electron: [...electron].sort(), fullWeb, fullElectron, unmapped };
}
