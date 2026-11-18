// Fake hub tool for Office tests: prints canned status and auto output.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const cmd = process.argv[2];
const manifest = JSON.parse(readFileSync(join(root, "brain.repos.json"), "utf8"));
const folders = [".", ...manifest.repos.map((r) => r.folder)];
const canned = join(root, `hub-${cmd}.txt`);
if (existsSync(canned)) {
  process.stdout.write(readFileSync(canned, "utf8"));
} else if (cmd === "status") {
  for (const f of folders) console.log(`${f.padEnd(26)} 2026-11-18  clean`);
  console.log("Ahead/behind counts use the last fetch; `sync` refreshes them.");
} else if (cmd === "auto") {
  for (const f of folders) console.log(`${f.padEnd(26)} up to date`);
  console.log("brain auto-sync: 0 pulled, 0 pushed");
} else {
  console.log("usage: node tools/hub.mjs [status|auto]");
}
