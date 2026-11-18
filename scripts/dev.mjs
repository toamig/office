// `npm run dev`: seeds .dev/ and starts electron-vite with a fake home, fake data folder, the
// fixture workspace and fake claude/codex CLIs, so development never touches the real setup.
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { seedDev } from "./seed-dev.mjs";

const repo = resolve(import.meta.dirname, "..");
const p = seedDev();
const bin = join(
  repo,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-vite.cmd" : "electron-vite",
);

const child = spawn(bin, ["dev", ...process.argv.slice(2)], {
  cwd: repo,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    OFFICE_HOME: p.home,
    OFFICE_DATA: p.data,
    OFFICE_WORKSPACE: p.hub,
    GIT_CONFIG_GLOBAL: p.gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    OFFICE_BIN_CLAUDE: join(repo, "tests/fixtures/bin/fake-claude.mjs"),
    OFFICE_BIN_CODEX: join(repo, "tests/fixtures/bin/fake-codex.mjs"),
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
