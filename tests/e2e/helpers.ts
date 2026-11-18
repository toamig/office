import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repoRoot = resolve(__dirname, "../..");

export interface Launched {
  app: ElectronApplication;
  data: string;
  home: string;
}

/** Launches the built app against a fresh data folder and a fake home. Never touches real data. */
export async function launch(env: Record<string, string> = {}): Promise<Launched> {
  const base = mkdtempSync(join(tmpdir(), "office-e2e-"));
  const data = join(base, "data");
  const home = join(base, "home");
  const app = await electron.launch({
    args: [repoRoot],
    env: { ...process.env, OFFICE_DATA: data, OFFICE_HOME: home, ...env } as Record<string, string>,
  });
  return { app, data, home };
}
