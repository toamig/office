// Fake hub tool for Office tests: prints canned status and auto output, and stubs the rest.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
} else if (cmd === "readmes") {
  // Writes a front page into every repo that has a brain.json, like the real tool.
  for (const f of manifest.repos.map((r) => r.folder)) {
    const dir = join(root, f);
    if (!existsSync(join(dir, "brain.json"))) continue;
    mkdirSync(join(dir, ".github"), { recursive: true });
    writeFileSync(join(dir, ".github", "README.md"), `# ${f}\n\nA front page.\n`);
  }
  console.log("readmes written");
} else if (cmd === "github" || cmd === "clone") {
  console.log(`${cmd} done`);
} else {
  console.log("usage: node tools/hub.mjs [status|auto|readmes|github|clone]");
}
