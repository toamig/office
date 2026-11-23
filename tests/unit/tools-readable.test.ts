import { createServer, type Server } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBrainSync } from "../../src/main/modules/setup/brain-sync";
import { splitCommand, testConnection } from "../../src/main/modules/setup/mcp-test";
import { ToolConfigService } from "../../src/main/modules/setup/tool-config";
import { SIDEBAR_ORDER } from "../../src/renderer/src/lib/views";
import { groupOf } from "../../src/shared/tool-config";
import { tmp, write } from "../fixtures/repos/make";

let root: string;
let tools: ToolConfigService;
beforeEach(() => {
  root = tmp("office-tools-readable-");
  tools = new ToolConfigService({
    home: () => join(root, "home"),
    project: (id) => id === "alpha" ? join(root, "alpha") : undefined,
    backups: () => join(root, "backups"),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A stdio server that answers initialize and lists five tools over two pages. */
const SERVER = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture-server" } } });
  else if (message.method === "tools/list") {
    const first = !message.params || !message.params.cursor;
    send({ id: message.id, result: { tools: first ? [{ name: "a" }, { name: "b" }, { name: "c" }] : [{ name: "d" }, { name: "e" }], ...(first ? { nextCursor: "2" } : {}) } });
  }
});
`;

describe("the Tools view reads in plain words", () => {
  it("names each tool, says what it does and keeps the file, setting and command as details", () => {
    write(root, "home/.claude/skills/frontend-design/SKILL.md", "---\nname: frontend-design\ndescription: Builds clean interfaces from a brief\n---\n\nBody");
    write(root, "home/.claude/settings.json", JSON.stringify({
      enabledPlugins: { "writer@market": true },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node notify.mjs" }] }] },
    }));
    write(root, "home/.claude.json", JSON.stringify({ mcpServers: {
      supabase: { type: "http", url: "https://mcp.supabase.com/mcp" },
      files: { command: "npx", args: ["-y", "files-server"] },
    } }));
    write(root, "home/.claude/plugins/installed_plugins.json", JSON.stringify({ plugins: { "writer@market": [{ installPath: join(root, "plugin-writer") }], "other@market": [{ installPath: join(root, "none") }] } }));
    write(root, "plugin-writer/.claude-plugin/plugin.json", JSON.stringify({ name: "writer", description: "Helps write documents" }));
    const list = tools.list();
    const by = (name: string) => list.find((entry) => entry.name === name)!;
    expect(by("frontend-design")).toMatchObject({ title: "Frontend design", description: "Builds clean interfaces from a brief", configKey: "frontend-design" });
    expect(by("supabase")).toMatchObject({ title: "Supabase", description: "Connects to mcp.supabase.com.", command: "https://mcp.supabase.com/mcp", kind: "connector" });
    expect(by("files")).toMatchObject({ description: "Runs npx on this computer.", command: "npx -y files-server" });
    expect(by("writer@market")).toMatchObject({ title: "Writer", description: "Helps write documents" });
    const hook = list.find((entry) => entry.kind === "hook")!;
    expect(hook.title).toBe("When the agent finishes");
    expect(hook.description).toBe("Runs node notify.mjs.");
    expect(list.map((entry) => groupOf(entry.kind)).sort()).toEqual(["automatic", "connections", "connections", "plugins", "skills"]);
    // The plain words never contain a path or a key; those sit in their own fields.
    for (const entry of list) expect(`${entry.title} ${entry.description}`).not.toMatch(/[\\/]|\.json|\.toml/);
  });

  it("turns a switched-off tool back on", () => {
    write(root, "home/.codex/config.toml", '[mcp_servers.fixture]\ncommand = "fixture"\nenabled = false\n');
    write(root, "home/.claude/settings.json", JSON.stringify({ enabledPlugins: { "writer@market": false } }));
    for (const entry of tools.list().filter((item) => item.disabled)) {
      const preview = tools.preview({ action: "enable", id: entry.id });
      tools.apply(preview.id);
    }
    expect(tools.list().every((entry) => !entry.disabled)).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "home/.claude/settings.json"), "utf8")).enabledPlugins["writer@market"]).toBe(true);
    // A tool that is already on cannot be "turned on".
    expect(() => tools.preview({ action: "enable", id: tools.list()[0]!.id })).toThrow(/already on/);
  });

  it("adds a connection command with its arguments split, and lists plugins that are installed and off", () => {
    write(root, "home/.claude.json", "{}");
    const preview = tools.preview({ action: "add", provider: "claude-code", kind: "mcp", name: "files", value: 'npx -y "files server"' });
    tools.apply(preview.id);
    expect(JSON.parse(readFileSync(join(root, "home/.claude.json"), "utf8")).mcpServers.files).toEqual({ command: "npx", args: ["-y", "files server"] });
    write(root, "home/.claude/plugins/installed_plugins.json", JSON.stringify({ plugins: { "a@m": [{}], "b@m": [{}] } }));
    write(root, "home/.claude/settings.json", JSON.stringify({ enabledPlugins: { "a@m": true } }));
    expect(tools.availablePlugins("claude-code").map((plugin) => plugin.id)).toEqual(["b@m"]);
    expect(splitCommand("npx -y 'two words' last")).toEqual(["npx", "-y", "two words", "last"]);
  });

  it("the sidebar order puts Chat after Sessions and leaves Setup out for the bottom", () => {
    expect(SIDEBAR_ORDER).toEqual(["home", "projects", "agents", "explore", "board", "git", "brain", "workflows", "tools", "inbox"]);
    expect(SIDEBAR_ORDER).not.toContain("setup");
  });

  it("reads the Brain auto-sync task state from the task list output", () => {
    const row = '"PC","\\Brain auto-sync","11/23/2026 12:30:33 PM","Ready","Interactive only","11/23/2026 12:15:34 PM","0","N/A"';
    expect(parseBrainSync(`${row}\n`)).toEqual({ state: "on", next: "11/23/2026 12:30:33 PM", last: "11/23/2026 12:15:34 PM", lastResultOk: true });
    expect(parseBrainSync(row.replace('"Ready"', '"Disabled"').replace('"0"', '"1"'))).toMatchObject({ state: "off", lastResultOk: false });
    expect(parseBrainSync("")).toMatchObject({ state: "missing" });
  });
});

describe("trying a connection before it is saved", () => {
  it("counts the tools of a program that speaks MCP over its output, across pages", async () => {
    write(root, "server.cjs", SERVER);
    const node = process.execPath;
    const result = await testConnection({ command: node, args: [join(root, "server.cjs")] }, 15_000);
    expect(result).toEqual({ ok: true, tools: 5, server: "fixture-server", error: null });
  });

  it("reports a program that stops without answering", async () => {
    write(root, "bad.cjs", 'console.error("cannot start: missing key"); process.exit(3);');
    const result = await testConnection({ command: process.execPath, args: [join(root, "bad.cjs")] }, 15_000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot start");
  });

  describe("over a web address", () => {
    let server: Server;
    let address = "";
    beforeEach(async () => {
      server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        request.on("end", () => {
          const message = body ? JSON.parse(body) as { id?: number; method: string } : { method: "" };
          if (request.url === "/locked") { response.writeHead(401).end(); return; }
          if (message.method === "initialize") {
            response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
            response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "web-fixture" } } }));
          } else if (message.method === "tools/list") {
            if (request.headers["mcp-session-id"] !== "s1") { response.writeHead(400).end(); return; }
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "x" }, { name: "y" }] } })}\n\n`);
          } else response.writeHead(202).end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });
    afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("keeps the session and reads an event-stream reply", async () => {
      expect(await testConnection({ address: `${address}/mcp` }, 10_000)).toEqual({ ok: true, tools: 2, server: "web-fixture", error: null });
    });

    it("says when the server asks for a sign-in, and refuses a bad address", async () => {
      expect((await testConnection({ address: `${address}/locked` }, 10_000)).error).toMatch(/sign-in/);
      expect((await testConnection({ address: "not an address" }, 1000)).error).toMatch(/web address/);
    });
  });
});
