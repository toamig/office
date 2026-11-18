// `npm run release`: builds the Windows installer and publishes it to the GitHub Releases of
// toamig/office, where the installed apps pick it up through electron-updater. Only the owner runs
// this, with a GitHub token in GH_TOKEN; it is never part of the build checks.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  console.error(
    "Set GH_TOKEN to a GitHub token that can create releases on toamig/office, then run again.",
  );
  process.exit(1);
}
const root = resolve(import.meta.dirname, "..");
const shell = process.platform === "win32";
for (const args of [
  ["electron-vite", "build"],
  ["electron-builder", "--win", "nsis", "--publish", "always"],
]) {
  const result = spawnSync("npx", args, { cwd: root, stdio: "inherit", shell });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
