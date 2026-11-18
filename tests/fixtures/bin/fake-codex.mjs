// A fake `codex` CLI for tests. Rejects a config with service_tier = "default" like CLI 0.117.0 does.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const home = process.env["OFFICE_HOME"] ?? "";
const config = join(home, ".codex", "config.toml");

function configProblem() {
  if (!home || !existsSync(config)) return null;
  return /service_tier\s*=\s*"default"/.test(readFileSync(config, "utf8"))
    ? `Error loading configuration: ${config}:4:16: unknown variant \`default\`, expected \`fast\` or \`flex\``
    : null;
}

if (args[0] === "--version") {
  console.log("codex-cli 0.117.0");
} else if (args[0] === "login" && args[1] === "status") {
  const problem = configProblem();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  console.log("Logged in using ChatGPT");
} else {
  console.log("fake-codex: unhandled arguments " + JSON.stringify(args));
}
