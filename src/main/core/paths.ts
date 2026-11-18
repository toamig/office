import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The user home, or the fake home when OFFICE_HOME is set. */
export function userHome(): string {
  return process.env["OFFICE_HOME"] ? resolve(process.env["OFFICE_HOME"]) : homedir();
}

/** The folder where Office keeps its own data. OFFICE_DATA overrides it entirely. */
export function dataDir(): string {
  if (process.env["OFFICE_DATA"]) return resolve(process.env["OFFICE_DATA"]);
  const home = userHome();
  if (process.platform === "win32") {
    return join(process.env["APPDATA"] ?? join(home, "AppData", "Roaming"), "Office");
  }
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Office");
  return join(process.env["XDG_CONFIG_HOME"] ?? join(home, ".config"), "Office");
}

/** The workspace repo override (OFFICE_WORKSPACE), if any. */
export function workspaceOverride(): string | undefined {
  return process.env["OFFICE_WORKSPACE"] ? resolve(process.env["OFFICE_WORKSPACE"]) : undefined;
}

export const claudeDir = (): string => join(userHome(), ".claude");
export const claudeSettingsPath = (): string => join(claudeDir(), "settings.json");
export const codexDir = (): string => join(userHome(), ".codex");
export const codexConfigPath = (): string => join(codexDir(), "config.toml");

export const settingsPath = (): string => join(dataDir(), "settings.json");
export const relayInfoPath = (): string => join(dataDir(), "relay.json");
export const dbPath = (): string => join(dataDir(), "office.db");
export const runsDir = (): string => join(dataDir(), "runs");
export const tasksDir = (): string => join(dataDir(), "tasks");
export const sessionsDir = (): string => join(dataDir(), "sessions");
export const exploreDir = (): string => join(dataDir(), "explore");
export const modulesDir = (): string => join(dataDir(), "modules");
