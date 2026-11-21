import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { resolveTool } from "../../core/exec";
import { writeTextFile } from "../../core/settings";

/**
 * How long Claude Code waits for one call of the permission tool: a week, in milliseconds. The owner may
 * answer hours later. The limit is a hard wall-clock one per call (the per-server `timeout` of the MCP
 * config), so it is set high instead of relying on keep-alives.
 */
export const PERMISSION_TOOL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConversationMcp {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function server(bridgeScript: string, runId: string): ConversationMcp {
  // The bridge finds Office through relay.json, so the folders that locate it travel with it.
  const env: Record<string, string> = {};
  for (const key of ["OFFICE_DATA", "OFFICE_HOME"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return {
    command: resolveTool("node") ?? "node",
    args: [bridgeScript, runId],
    env,
  };
}

export class ConversationBridge {
  private readonly secret = randomBytes(32);

  constructor(private readonly script: string, private readonly workspace: () => string) {}

  private token(id: string): string {
    return createHmac("sha256", this.secret).update(JSON.stringify([this.workspace(), id])).digest("hex");
  }

  valid(id: string, authorization: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.token(id)}`);
    const actual = Buffer.from(authorization ?? "");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  config(id: string): ConversationMcp {
    const config = server(this.script, id);
    config.env["OFFICE_CONVERSATION_TOKEN"] = this.token(id);
    return config;
  }
}

/** Writes the MCP config that gives one headless run the office_permission tool. */
export function writePermissionMcpConfig(dir: string, runId: string, bridgeScript: string): string {
  const file = join(dir, "mcp-permission.json");
  writeTextFile(file, `${claudeMcpConfig(server(bridgeScript, runId))}\n`);
  return file;
}

export function claudeMcpConfig(config: ConversationMcp): string {
  return JSON.stringify({ mcpServers: { office: { type: "stdio", ...config, timeout: PERMISSION_TOOL_TIMEOUT_MS } } });
}
