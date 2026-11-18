import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeWorld, type World } from "../fixtures/vault/make";

export const repoRoot = resolve(__dirname, "../..");

export interface Launched {
  app: ElectronApplication;
  base: string;
  data: string;
  home: string;
  gitConfig: string;
  world?: World;
}

const GIT_CONFIG = [
  "[user]",
  "\tname = Office E2E",
  "\temail = e2e@example.invalid",
  "[init]",
  "\tdefaultBranch = main",
  "[commit]",
  "\tgpgsign = false",
  '[protocol "file"]',
  "\tallow = always",
  "",
].join("\n");

/** Makes the test process itself use a clean git config (fixtures build repos here). */
export function useCleanGitConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "office-e2e-gitcfg-"));
  const path = join(dir, "gitconfig");
  writeFileSync(path, GIT_CONFIG);
  process.env["GIT_CONFIG_GLOBAL"] = path;
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";
  return path;
}

export interface LaunchOptions {
  env?: Record<string, string>;
  /** Build a fixture world (brain hub plus two code repos) and preconfigure settings for it. */
  world?: boolean;
  /** Extra machine-settings fields, e.g. a relay port. */
  settings?: Record<string, unknown>;
  base?: string;
}

/** Launches the built app against a fresh data folder and a fake home. Never touches real data. */
export async function launch(options: LaunchOptions = {}): Promise<Launched> {
  const gitConfig = useCleanGitConfig();
  const base = options.base ?? mkdtempSync(join(tmpdir(), "office-e2e-"));
  const data = join(base, "data");
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  let world: World | undefined;
  if (options.world) {
    world = makeWorld();
    mkdirSync(data, { recursive: true });
    writeFileSync(
      join(data, "settings.json"),
      JSON.stringify({
        version: 1,
        workspaceRoot: world.hub,
        workspaceConfigPath: world.workspaceConfigPath,
        projectsRoot: world.projectsRoot,
        editorCommand: "code",
        relay: { port: 47999, token: "e2e-token" },
        ...options.settings,
      }),
    );
  }
  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      OFFICE_DATA: data,
      OFFICE_HOME: home,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      ...options.env,
    } as Record<string, string>,
  });
  return { app, base, data, home, gitConfig, ...(world ? { world } : {}) };
}
