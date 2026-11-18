import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repoRoot = resolve(__dirname, "../..");

export interface Launched {
  app: ElectronApplication;
  base: string;
  data: string;
  home: string;
}

const GIT_CONFIG = [
  "[user]",
  "\tname = Office E2E",
  "\temail = e2e@example.invalid",
  "[init]",
  "\tdefaultBranch = main",
  "[commit]",
  "\tgpgsign = false",
  "",
].join("\n");

/** Launches the built app against a fresh data folder and a fake home. Never touches real data. */
export async function launch(
  env: Record<string, string> = {},
  base = mkdtempSync(join(tmpdir(), "office-e2e-")),
): Promise<Launched> {
  const data = join(base, "data");
  const home = join(base, "home");
  const gitConfig = join(base, "gitconfig");
  writeFileSync(gitConfig, GIT_CONFIG);
  const app = await electron.launch({
    args: [repoRoot],
    env: {
      ...process.env,
      OFFICE_DATA: data,
      OFFICE_HOME: home,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      ...env,
    } as Record<string, string>,
  });
  return { app, base, data, home };
}
