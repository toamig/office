// Fake brain tool for Office tests. `validate` fails when a FAIL_VALIDATE file exists in the hub
// root; `reindex` fills the generated block of every router it finds with a stub table.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const command = process.argv[2];

if (command === "validate") {
  if (existsSync(join(root, "FAIL_VALIDATE"))) {
    console.log("warn  tag 'x' is used once; consider merging it away");
    console.log("ERROR Alpha/OpenItems.md: broken link [[Alpha/Missing]]");
    console.log("\nhub: 6 files, 1 errors, 1 warnings, 0 external links");
    process.exit(1);
  }
  // A stale router is a warning Office can fix itself by reindexing; it clears once a reindex has run.
  if (existsSync(join(root, "STALE_ROUTER")) && !existsSync(join(root, ".git", "REINDEXED"))) {
    console.log("warn  Alpha/_index.md: router table is out of date, run reindex");
    console.log("\nhub: 6 files, 0 errors, 1 warnings, 0 external links");
  } else console.log("\nhub: 6 files, 0 errors, 0 warnings, 0 external links");
} else if (command === "reindex") {
  let wrote = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = join(root, entry.name, "_index.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const begin = text.indexOf("<!-- BEGIN GENERATED -->");
    const end = text.indexOf("<!-- END GENERATED -->");
    if (begin < 0 || end < begin) continue;
    const table = "\n| Doc | Type |\n|---|---|\n| [[" + entry.name + "/Overview]] | overview |\n";
    const next = text.slice(0, begin) + "<!-- BEGIN GENERATED -->" + table + text.slice(end);
    if (next !== text) {
      writeFileSync(file, next);
      wrote++;
    }
  }
  // Remembered inside .git, so it is never a file of the brain.
  if (existsSync(join(root, ".git"))) writeFileSync(join(root, ".git", "REINDEXED"), "1");
  console.log(`\n${wrote} router(s) rewritten`);
} else {
  console.log("fixture: only validate and reindex are implemented");
  process.exit(2);
}
