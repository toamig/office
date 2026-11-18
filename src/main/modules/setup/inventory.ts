import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type { Inventory, InventoryItem } from "../../../shared/models";
import { resolveTool, run } from "../../core/exec";
import { claudeDir, claudeSettingsPath, codexConfigPath } from "../../core/paths";

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Name and description from a SKILL.md frontmatter block. */
function skillInfo(file: string): { name?: string; description?: string } {
  try {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const match = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!match?.[1]) return {};
    const meta = parseYaml(match[1]) as { name?: string; description?: string };
    return {
      ...(meta.name ? { name: String(meta.name) } : {}),
      ...(meta.description ? { description: String(meta.description) } : {}),
    };
  } catch {
    return {};
  }
}

function skillsIn(dir: string, source: InventoryItem["source"]): InventoryItem[] {
  if (!existsSync(dir)) return [];
  const items: InventoryItem[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, "SKILL.md");
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const info = skillInfo(file);
    items.push({
      kind: "skill",
      name: info.name ?? entry.name,
      ...(info.description ? { detail: info.description.slice(0, 160) } : {}),
      source,
    });
  }
  return items;
}

function settingsItems(
  settings: Record<string, unknown>,
  source: InventoryItem["source"],
): InventoryItem[] {
  const items: InventoryItem[] = [];
  if (typeof settings["model"] === "string")
    items.push({ kind: "model", name: settings["model"], source });
  const plugins = settings["enabledPlugins"] as Record<string, boolean> | undefined;
  for (const [name, enabled] of Object.entries(plugins ?? {})) {
    items.push({ kind: "plugin", name, detail: enabled ? "enabled" : "disabled", source });
  }
  const hooks = settings["hooks"] as
    Record<string, Array<{ hooks?: Array<{ command?: string }> }>> | undefined;
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        items.push({
          kind: "hook",
          name: event,
          ...(hook.command ? { detail: hook.command } : {}),
          source,
        });
      }
    }
  }
  return items;
}

/** Parses `claude mcp list` lines such as `name: command - status`. */
export function parseClaudeMcpList(text: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^\s:][^:]*): (.+?) - (.+)$/.exec(line.trim());
    if (m?.[1] && m[2] && m[3]) {
      items.push({
        kind: "mcp",
        name: m[1],
        detail: `${m[2]} (${m[3].replace(/^[^\w]+/, "")})`,
        source: "user",
      });
    }
  }
  return items;
}

export async function claudeInventory(projectPath?: string): Promise<Inventory> {
  const items: InventoryItem[] = [
    ...settingsItems(readJson(claudeSettingsPath()), "user"),
    ...skillsIn(join(claudeDir(), "skills"), "user"),
  ];
  if (resolveTool("claude")) {
    const mcp = await run("claude", ["mcp", "list"], { timeoutMs: 45_000, cwd: projectPath });
    if (mcp.code === 0) items.push(...parseClaudeMcpList(mcp.stdout));
  }
  if (projectPath) {
    const dir = join(projectPath, ".claude");
    items.push(
      ...settingsItems(readJson(join(dir, "settings.json")), "project"),
      ...skillsIn(join(dir, "skills"), "project"),
    );
  }
  return { provider: "claude-code", label: "Claude Code", items };
}

export function codexInventory(): Inventory {
  const items: InventoryItem[] = [];
  const path = codexConfigPath();
  if (existsSync(path)) {
    try {
      const config = parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (typeof config["model"] === "string")
        items.push({ kind: "model", name: config["model"], source: "user" });
      if (Array.isArray(config["notify"])) {
        items.push({
          kind: "notify",
          name: "notify",
          detail: config["notify"].join(" "),
          source: "user",
        });
      }
      const servers = config["mcp_servers"] as
        Record<string, { command?: string; url?: string }> | undefined;
      for (const [name, server] of Object.entries(servers ?? {})) {
        items.push({
          kind: "mcp",
          name,
          ...(server.command || server.url ? { detail: server.command ?? server.url ?? "" } : {}),
          source: "user",
        });
      }
    } catch {
      /* an unreadable config shows as an empty inventory; Setup already reports the CLI problem */
    }
  }
  return { provider: "codex", label: "Codex", items };
}

export async function readInventories(projectPath?: string): Promise<Inventory[]> {
  return [await claudeInventory(projectPath), codexInventory()];
}
