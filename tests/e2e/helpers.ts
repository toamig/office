import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  /** Where the fake gh creates its bare repos. */
  ghRemotes: string;
  world?: World;
}

/** The fake GitHub owner that fake-gh reports, and the SSH base git rewrites to local folders. */
export const FAKE_OWNER = "fixture-owner";

function gitConfigText(ghRemotes: string): string {
  return [
    "[user]",
    "\tname = Office E2E",
    "\temail = e2e@example.invalid",
    "[init]",
    "\tdefaultBranch = main",
    "[commit]",
    "\tgpgsign = false",
    '[protocol "file"]',
    "\tallow = always",
    `[url "${ghRemotes.replace(/\\/g, "/")}/"]`,
    `\tinsteadOf = git@github.com:${FAKE_OWNER}/`,
    "",
  ].join("\n");
}

/** Makes the test process itself use a clean git config (fixtures build repos here). */
export function useCleanGitConfig(ghRemotes = join(tmpdir(), "office-e2e-ghremotes")): string {
  const dir = mkdtempSync(join(tmpdir(), "office-e2e-gitcfg-"));
  const path = join(dir, "gitconfig");
  writeFileSync(path, gitConfigText(ghRemotes));
  process.env["GIT_CONFIG_GLOBAL"] = path;
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";
  return path;
}

export interface LaunchOptions {
  env?: Record<string, string>;
  /** Build a fixture world (brain hub plus two code repos) and preconfigure settings for it. */
  world?: boolean | "unconfigured";
  /** Copy tests/fixtures/home into the fake home and point claude, codex and gh at the fake CLIs. */
  fakeTools?: boolean;
  /** Extra machine-settings fields, e.g. a relay port. */
  settings?: Record<string, unknown>;
  base?: string;
  /** Launch the packaged app from release/win-unpacked instead of the built sources. */
  packaged?: boolean;
}

export const packagedExe = join(repoRoot, "release", "win-unpacked", "Office.exe");

/** Launches the built app against a fresh data folder and a fake home. Never touches real data. */
export async function launch(options: LaunchOptions = {}): Promise<Launched> {
  const base = options.base ?? mkdtempSync(join(tmpdir(), "office-e2e-"));
  const ghRemotes = join(base, "gh-remotes");
  mkdirSync(ghRemotes, { recursive: true });
  const gitConfig = useCleanGitConfig(ghRemotes);
  const data = join(base, "data");
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  const toolEnv: Record<string, string> = { FAKE_GH_REMOTES: ghRemotes };
  if (options.fakeTools) {
    cpSync(join(repoRoot, "tests/fixtures/home"), home, { recursive: true });
    toolEnv["OFFICE_BIN_CLAUDE"] = join(repoRoot, "tests/fixtures/bin/fake-claude.mjs");
    toolEnv["OFFICE_BIN_CODEX"] = join(repoRoot, "tests/fixtures/bin/fake-codex.mjs");
    toolEnv["OFFICE_BIN_FAKE_CLAUDE"] = join(repoRoot, "tests/fixtures/bin/fake-claude.mjs");
    toolEnv["OFFICE_BIN_GH"] = join(repoRoot, "tests/fixtures/bin/fake-gh.mjs");
  }
  let world: World | undefined;
  if (options.world) {
    world = makeWorld();
    mkdirSync(data, { recursive: true });
    if (options.world === true) {
      // A second launch on the same folder keeps what the first one saved (window bounds, theme).
      const settingsFile = join(data, "settings.json");
      const before = existsSync(settingsFile)
        ? (JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, unknown>)
        : {};
      writeFileSync(
        settingsFile,
        JSON.stringify({
          version: 1,
          workspaceRoot: world.hub,
          workspaceConfigPath: world.workspaceConfigPath,
          projectsRoot: world.projectsRoot,
          editorCommand: "code",
          relay: { port: 47999, token: "e2e-token" },
          ...before,
          ...options.settings,
        }),
      );
    }
  }
  const app = await electron.launch({
    ...(options.packaged ? { executablePath: packagedExe } : {}),
    args: options.packaged ? [] : [repoRoot],
    env: {
      ...process.env,
      OFFICE_DATA: data,
      OFFICE_HOME: home,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      ...toolEnv,
      ...options.env,
    } as Record<string, string>,
  });
  return { app, base, data, home, gitConfig, ghRemotes, ...(world ? { world } : {}) };
}

/**
 * Everything the first terminal on the page shows, as text. The terminal draws on a canvas, so its text is
 * read from its buffer instead of from the page.
 */
export async function terminalText(win: Page): Promise<string> {
  return win.evaluate(() => {
    const host = document.querySelector('[data-testid="terminal"]') as
      | (HTMLElement & {
          __term?: {
            buffer: {
              active: {
                length: number;
                getLine: (i: number) => { translateToString: (t: boolean) => string } | undefined;
              };
            };
          };
        })
      | null;
    const buffer = host?.__term?.buffer.active;
    if (!buffer) return "";
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++)
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n");
  });
}
