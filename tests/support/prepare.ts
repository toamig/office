import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { freshWorld, type World } from "../fixtures/vault/make";

export const repoRoot = resolve(__dirname, "../..");

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
}

/** The folders and environment of one app or host run. Nothing in it touches the owner's real data. */
export interface Prepared {
  base: string;
  data: string;
  home: string;
  gitConfig: string;
  /** Where the fake gh creates its bare repos. */
  ghRemotes: string;
  world?: World;
  /** The environment to start the app or host with, on top of the process's own. */
  env: Record<string, string>;
}

/**
 * Builds the fake home, the data folder, the fixture world and the settings for one run, and the environment
 * that points the app or the test host at them. `relayPort` 0 lets parallel runs each take a free port.
 */
export function prepareLaunch(options: LaunchOptions, relayPort: number): Prepared {
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
    world = freshWorld();
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
          relay: { port: relayPort, token: "e2e-token" },
          // The older specs drive terminals; the chat specs ask for a chat.
          sessionMode: "terminal",
          // The welcome flow has its own specs; every other spec starts on a machine that is set up.
          welcomeDone: true,
          ...before,
          ...options.settings,
        }),
      );
    }
  }
  return {
    base,
    data,
    home,
    gitConfig,
    ghRemotes,
    ...(world ? { world } : {}),
    env: {
      OFFICE_DATA: data,
      OFFICE_HOME: home,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      ...toolEnv,
      ...options.env,
    },
  };
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

/**
 * Chooses an option of one of Office's dropdowns (they are buttons with a menu, not form selects): by its
 * visible label, or by its value when given a plain string.
 */
export async function pick(
  win: Page,
  testId: string,
  choice: string | { label: string },
): Promise<void> {
  await win.getByTestId(testId).click();
  const menu = win.getByTestId("select-menu");
  const option =
    typeof choice === "string"
      ? menu.locator(`[data-value="${choice}"]`)
      : menu.getByRole("option", { name: choice.label, exact: true });
  await option.click();
}

/** The relay's address for a run, read from its settings (the relay takes a free port, so runs never meet). */
export function relayUrl(data: string): string {
  const settings = JSON.parse(readFileSync(join(data, "settings.json"), "utf8")) as {
    relay: { port: number };
  };
  return `http://127.0.0.1:${settings.relay.port}`;
}
