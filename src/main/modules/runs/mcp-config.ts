import { join } from "node:path";
import { resolveTool } from "../../core/exec";
import { writeTextFile } from "../../core/settings";

/**
 * How long Claude Code waits for one call of the permission tool: a week, in milliseconds. The owner may
 * answer hours later. The limit is a hard wall-clock one per call (the per-server `timeout` of the MCP
 * config), so it is set high instead of relying on keep-alives.
 */
export const PERMISSION_TOOL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/** Writes the MCP config that gives one headless run the office_permission tool; returns its path. */
export function writePermissionMcpConfig(dir: string, runId: string, bridgeScript: string): string {
  // The bridge finds Office through relay.json, so the folders that locate it travel with it.
  const env: Record<string, string> = {};
  for (const key of ["OFFICE_DATA", "OFFICE_HOME"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  const config = {
    mcpServers: {
      office: {
        type: "stdio",
        command: resolveTool("node") ?? "node",
        args: [bridgeScript, runId],
        env,
        timeout: PERMISSION_TOOL_TIMEOUT_MS,
      },
    },
  };
  const file = join(dir, "mcp-permission.json");
  writeTextFile(
    file,
    `${JSON.stringify(config, null, 2)}
`,
  );
  return file;
}
