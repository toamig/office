import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MachineSettings as MachineSettingsSchema } from "../../shared/schemas";
import type { MachineSettings } from "../../shared/types";
import { settingsPath, workspaceOverride } from "./paths";

export const DEFAULT_RELAY_PORT = 47821;

function freshSettings(): MachineSettings {
  return MachineSettingsSchema.parse({
    version: 1,
    relay: { port: DEFAULT_RELAY_PORT, token: randomBytes(32).toString("hex") },
  });
}

/** Writes a file atomically exactly as given (UTF-8, no line-ending conversion). For files that are not ours. */
export function writeRawFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { encoding: "utf8" });
  renameSync(tmp, path);
}

/** Writes a file atomically as UTF-8 without BOM and with LF endings. */
export function writeTextFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text.replace(/\r\n/g, "\n"), { encoding: "utf8" });
  renameSync(tmp, path);
}

/** Reads settings from disk, creating the file with defaults on first run. No overrides applied. */
export function readSettings(path: string = settingsPath()): MachineSettings {
  try {
    return MachineSettingsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    const settings = freshSettings();
    saveSettings(settings, path);
    return settings;
  }
}

/** Loads machine settings with the OFFICE_WORKSPACE override applied. Do not save the result. */
export function loadSettings(path: string = settingsPath()): MachineSettings {
  const settings = readSettings(path);
  const override = workspaceOverride();
  return override ? { ...settings, workspaceRoot: override } : settings;
}

/** Merges a patch into the settings on disk (without any override) and returns the loaded result. */
export function updateSettings(
  patch: Partial<MachineSettings>,
  path: string = settingsPath(),
): MachineSettings {
  saveSettings({ ...readSettings(path), ...patch }, path);
  return loadSettings(path);
}

export function saveSettings(settings: MachineSettings, path: string = settingsPath()): void {
  writeTextFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/** True once the first-run wizard has chosen a workspace and a projects folder. */
export function isConfigured(settings: MachineSettings): boolean {
  return Boolean(settings.workspaceRoot && settings.workspaceConfigPath && settings.projectsRoot);
}
