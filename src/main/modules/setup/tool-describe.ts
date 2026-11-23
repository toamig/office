import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ToolEntry } from "../../../shared/tool-config";
import { frontmatterValue } from "../notes/notes";
import { object, type Entry } from "./tool-documents";

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
/** "frontend-design" and "frontend_design" read as "Frontend design". */
export const plainName = (name: string): string => sentence(name.replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim());

const EVENTS: Record<string, string> = {
  Stop: "When the agent finishes", SubagentStop: "When a helper agent finishes", SessionStart: "When a session starts",
  SessionEnd: "When a session ends", PreToolUse: "Before a tool runs", PostToolUse: "After a tool runs",
  UserPromptSubmit: "When you send a message", Notification: "When the agent needs you", PreCompact: "Before the conversation is shortened",
};

/** The command of a connection, with its arguments, or null for an address. */
function commandLine(value: unknown): string | null {
  const config = object(value);
  const command = config["command"];
  if (typeof command !== "string") return null;
  const args = Array.isArray(config["args"]) ? config["args"].filter((arg): arg is string => typeof arg === "string") : [];
  return [command, ...args].join(" ");
}

function host(address: string): string {
  try { return new URL(address).host; } catch { return address; }
}

function skillDescription(path: string): string {
  try {
    const file = join(path, "SKILL.md");
    if (!existsSync(file)) return "";
    return frontmatterValue(readFileSync(file, "utf8").replaceAll("\r\n", "\n"), "description")?.slice(0, 240) ?? "";
  } catch {
    return "";
  }
}

/** Plugin manifests of the installed plugins, by "name@marketplace", read from the agent's plugin folder. */
export function installedPlugins(home: string): Map<string, { description: string; title: string }> {
  const plugins = new Map<string, { description: string; title: string }>();
  try {
    const data = JSON.parse(readFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "utf8")) as { plugins?: unknown };
    for (const [id, installs] of Object.entries(object(data.plugins))) {
      const first = Array.isArray(installs) ? object(installs[0]) : object(installs);
      const folder = first["installPath"];
      let description = "";
      if (typeof folder === "string") {
        try {
          const manifest = object(JSON.parse(readFileSync(join(folder, ".claude-plugin", "plugin.json"), "utf8")));
          if (typeof manifest["description"] === "string") description = manifest["description"].slice(0, 240);
        } catch { /* no manifest */ }
      }
      plugins.set(id, { description, title: plainName(id.split("@")[0] ?? id) });
    }
  } catch { /* none installed */ }
  return plugins;
}

/** Fills in the plain name, the one-line description and the details of a tool entry. */
export function describeEntry(entry: Entry, plugins: Map<string, { description: string; title: string }>): ToolEntry {
  const { doc: _doc, key, value, storageKind: _kind, hook: _hook, ...rest } = entry;
  const line = commandLine(value);
  const address = typeof object(value)["url"] === "string" ? (object(value)["url"] as string) : null;
  let title = plainName(entry.name);
  let description = "";
  if (entry.kind === "skill") {
    description = skillDescription(entry.path) || "A skill the agent can use.";
  } else if (entry.kind === "mcp" || entry.kind === "connector") {
    description = address ? `Connects to ${host(address)}.` : line ? `Runs ${basename(line.split(" ")[0] ?? "")} on this computer.` : "A connection.";
  } else if (entry.kind === "plugin") {
    const plugin = plugins.get(entry.name);
    title = plugin?.title ?? plainName(entry.name.split("@")[0] ?? entry.name);
    description = plugin?.description || (entry.name.includes("@") ? `A plugin from ${entry.name.split("@")[1]}.` : "A plugin.");
  } else if (entry.kind === "hook") {
    const event = EVENTS[entry.name];
    title = event ?? (key === "@notify" ? "When Codex needs you" : `On ${plainName(entry.name)}`);
    const summary = rest.detail ?? (Array.isArray(value) ? value.map((item) => String(item)).join(" ") : "");
    description = summary ? `Runs ${summary.length > 90 ? `${summary.slice(0, 89)}...` : summary}.` : "Runs a command.";
  }
  return { ...rest, title, description, configKey: key, ...(line ?? address ? { command: line ?? address ?? "" } : rest.detail ? { command: rest.detail } : {}) };
}
