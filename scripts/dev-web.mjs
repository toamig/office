// `npm run dev:web`: the real interface in your browser with hot reload, against a test host on the dev
// fixtures (a fake home, a fake data folder, the fixture workspace and the fake CLIs). Nothing real is touched.
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { seedDev } from "./seed-dev.mjs";

const repo = resolve(import.meta.dirname, "..");
const p = seedDev();
const win = process.platform === "win32";
const bin = (name) => join(repo, "node_modules", ".bin", win ? `${name}.cmd` : name);
const run = (cmd, args, options = {}) =>
  spawn(cmd, args, { cwd: repo, stdio: "inherit", shell: win, ...options });

// 1. The host, bundled once.
await new Promise((done, fail) =>
  run(bin("vite"), ["build", "-c", "vite.host.config.ts"]).on("exit", (c) =>
    c === 0 ? done() : fail(new Error("host build failed")),
  ),
);

// 2. The host, running as plain Node inside Electron's binary, on the dev fixtures.
const electron = (await import("electron")).default;
const token = "dev";
const host = spawn(electron, [join(repo, "out-web", "host", "index.js")], {
  cwd: repo,
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    OFFICE_HOST_PORT: "5184",
    OFFICE_HOST_TOKEN: token,
    OFFICE_HOME: p.home,
    OFFICE_DATA: p.data,
    OFFICE_WORKSPACE: p.hub,
    GIT_CONFIG_GLOBAL: p.gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    OFFICE_BIN_CLAUDE: join(repo, "tests/fixtures/bin/fake-claude.mjs"),
    OFFICE_BIN_CODEX: join(repo, "tests/fixtures/bin/fake-codex.mjs"),
  },
});
host.stdout.on("data", (d) => process.stdout.write(d));

// 3. The interface, from Vite with hot reload, talking to the host on its port.
const vite = run(bin("vite"), ["-c", "vite.web.config.ts"]);
console.log(`\nOpen http://localhost:5183/?host=ws://127.0.0.1:5184&token=${token}\n`);

const stop = () => {
  host.kill();
  vite.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", stop);
