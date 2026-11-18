// Seeds the .dev/ folders used by `npm run dev` from tests/fixtures: a fake home, a fake data
// folder with settings, and a fixture brain hub plus two code repos. Safe to run again; pass
// --reset to rebuild from scratch. Nothing here touches the real home, brain or GitHub.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
export const devRoot = join(repo, ".dev");
const reset = process.argv.includes("--reset");

export function devPaths() {
  return {
    home: join(devRoot, "home"),
    data: join(devRoot, "data"),
    hub: join(devRoot, "workspace", "Brain"),
    projects: join(devRoot, "projects"),
    gitConfig: join(devRoot, "gitconfig"),
  };
}

export function seedDev(options = {}) {
  const p = devPaths();
  if (options.reset ?? reset) rmSync(devRoot, { recursive: true, force: true });
  if (existsSync(p.hub)) return p;
  mkdirSync(devRoot, { recursive: true });
  writeFileSync(
    p.gitConfig,
    '[user]\n\tname = Office Dev\n\temail = dev@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[protocol "file"]\n\tallow = always\n',
  );
  const env = { ...process.env, GIT_CONFIG_GLOBAL: p.gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { env, stdio: "ignore" });

  const withRemote = (dir, bare, message) => {
    mkdirSync(bare, { recursive: true });
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "remote", "add", "origin", bare);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", message);
    git(dir, "push", "-q", "-u", "origin", "main");
  };

  cpSync(join(repo, "tests/fixtures/vault/template"), p.hub, { recursive: true });
  const nested = ["Common", "Alpha", "Beta", "Office"];
  nested.forEach((f) =>
    withRemote(join(p.hub, f), join(devRoot, "remotes", `${f}.git`), `${f}: initial`),
  );
  writeFileSync(join(p.hub, ".gitignore"), nested.map((f) => `${f}/\n`).join(""));
  withRemote(p.hub, join(devRoot, "remotes", "hub.git"), "hub: initial");

  for (const name of ["Alpha", "Beta"]) {
    const dir = join(p.projects, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), `# ${name}\n`);
    withRemote(dir, join(devRoot, "remotes", `code-${name}.git`), `${name}: initial`);
  }

  cpSync(join(repo, "tests/fixtures/home"), p.home, { recursive: true });
  mkdirSync(p.data, { recursive: true });
  writeFileSync(
    join(p.data, "settings.json"),
    `${JSON.stringify(
      {
        version: 1,
        workspaceRoot: p.hub,
        workspaceConfigPath: "Office/workspace.json",
        projectsRoot: p.projects,
        editorCommand: "code",
        relay: { port: 47822, token: "dev-token" },
      },
      null,
      2,
    )}\n`,
  );
  return p;
}

if (import.meta.filename === process.argv[1]) {
  const p = seedDev();
  console.log(`dev fixtures ready in ${p.home.replace(/[\\/]home$/, "")}`);
}
