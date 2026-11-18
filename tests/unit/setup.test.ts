import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearToolCache } from "../../src/main/core/exec";
import { detectClaude, detectCodex, detectTools } from "../../src/main/modules/setup/detect";
import {
  claudeInventory,
  codexInventory,
  parseClaudeMcpList,
} from "../../src/main/modules/setup/inventory";
import {
  cloneWorkspaceRepo,
  defaultWorkspace,
  inspectWorkspaceFolder,
  prepareWorkspace,
} from "../../src/main/modules/setup/workspace-setup";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import { tmp } from "../fixtures/repos/make";
import { makeWorld } from "../fixtures/vault/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

function fakeHome(): string {
  const home = tmp("office-home-");
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
  return home;
}

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  process.env["OFFICE_BIN_CODEX"] = join(fixtures, "bin/fake-codex.mjs");
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

describe("tool detection", () => {
  it("detects Claude Code with its login state", async () => {
    expect(await detectClaude()).toMatchObject({
      installed: true,
      loggedIn: true,
      version: "2.1.999",
    });
    process.env["FAKE_LOGGED_IN"] = "0";
    const out = await detectClaude();
    expect(out.loggedIn).toBe(false);
    expect(out.fix).toContain("claude auth login");
  });

  it("reports the Codex CLI older than the config, with its fix", async () => {
    fakeHome();
    const out = await detectCodex();
    expect(out).toMatchObject({ installed: true, loggedIn: null, version: "0.117.0" });
    expect(out.problem).toBe(
      "Codex CLI is older than your config; update it with npm i -g @openai/codex",
    );
    expect(out.fix).toContain("npm i -g @openai/codex");
  });

  it("reports Codex as logged in when the config loads", async () => {
    const home = fakeHome();
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "x"\n');
    expect(await detectCodex()).toMatchObject({ installed: true, loggedIn: true });
  });

  it("works with tools missing from PATH", async () => {
    process.env["OFFICE_BIN_CLAUDE"] = join(fixtures, "bin/does-not-exist.mjs");
    process.env["OFFICE_BIN_CODEX"] = join(fixtures, "bin/does-not-exist.mjs");
    const tools = await detectTools();
    const byId = Object.fromEntries(tools.map((t) => [t.id, t]));
    expect(byId["claude-code"]).toMatchObject({ installed: false });
    expect(byId["codex"]).toMatchObject({ installed: false });
    expect(byId["claude-code"]?.fix).toBeTruthy();
    expect(byId["git"]?.installed).toBe(true);
    expect(byId["node"]?.installed).toBe(true);
  });
});

describe("inventory", () => {
  it("lists hooks, plugins, models and skills from the fake home", async () => {
    const home = fakeHome();
    const skill = join(home, ".claude", "skills", "demo");
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: demo-skill\ndescription: Does a demo\n---\nBody\n",
    );
    const project = tmp("office-proj-");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ model: "sonnet" }));

    const inv = await claudeInventory(project);
    const names = (kind: string, source?: string) =>
      inv.items
        .filter((i) => i.kind === kind && (!source || i.source === source))
        .map((i) => i.name);
    expect(names("model", "user")).toEqual(["opus"]);
    expect(names("model", "project")).toEqual(["sonnet"]);
    expect(names("plugin")).toEqual(["example-plugin@market"]);
    expect(names("hook")).toEqual(["PreToolUse", "Stop"]);
    expect(names("skill")).toEqual(["demo-skill"]);
    expect(names("mcp")).toEqual(["notion", "other"]);
  });

  it("reads the Codex model, notify and MCP servers from config.toml", () => {
    fakeHome();
    const inv = codexInventory();
    expect(inv.items.map((i) => [i.kind, i.name])).toEqual([
      ["model", "gpt-5-codex"],
      ["notify", "notify"],
      ["mcp", "notion"],
    ]);
    expect(inv.items[1]?.detail).toBe("node C:/fake/codex-notify.js");
  });

  it("parses claude mcp list output", () => {
    const items = parseClaudeMcpList(
      "Checking MCP server health...\n\nnotion: npx -y @notionhq/notion-mcp-server - ✔ Connected\nhiggs: https://x.invalid/mcp (HTTP) - ! Needs authentication\n",
    );
    expect(items.map((i) => i.name)).toEqual(["notion", "higgs"]);
    expect(items[1]?.detail).toContain("Needs authentication");
  });
});

describe("workspace setup", () => {
  it("inspects a folder for configs and a brain hub", () => {
    const world = makeWorld();
    expect(inspectWorkspaceFolder(world.hub)).toEqual({
      exists: true,
      isGitRepo: true,
      hasBrainHub: true,
      configs: ["Office/workspace.json"],
    });
    expect(inspectWorkspaceFolder(join(world.root, "nope")).exists).toBe(false);
  });

  it("creates a starter config on request and validates the result", () => {
    const folder = tmp("office-ws-folder-");
    const projects = tmp("office-ws-projects-");
    const input = {
      workspaceRoot: folder,
      workspaceConfigPath: "Office/workspace.json",
      projectsRoot: projects,
      createIfMissing: false,
    };
    expect(() => prepareWorkspace(input)).toThrow(/does not exist yet/);
    prepareWorkspace({ ...input, createIfMissing: true });
    const loaded = loadWorkspaceFile(join(folder, "Office/workspace.json"));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.workspace.vault.kind).toBe("folder");
    expect(() => prepareWorkspace({ ...input, workspaceConfigPath: "../x.json" })).toThrow(
      /inside the workspace/,
    );
    expect(() => prepareWorkspace({ ...input, projectsRoot: join(folder, "missing") })).toThrow(
      /not a folder/,
    );
    writeFileSync(join(folder, "Office/workspace.json"), "{ bad");
    expect(() => prepareWorkspace(input)).toThrow(/Invalid JSON/);
  });

  it("uses a brain-hub vault when the folder has brain.repos.json", () => {
    expect(defaultWorkspace(true).vault.kind).toBe("brain-hub");
    expect(defaultWorkspace(false).projects).toEqual([]);
  });

  it("clones a workspace repo and runs the hub tool for a brain hub", async () => {
    const world = makeWorld();
    const dest = join(tmp("office-clone-"), "hub");
    const result = await cloneWorkspaceRepo(world.remotes["."] as string, dest);
    expect(result).toEqual({ path: dest, hubCloned: true });
    expect(existsSync(join(dest, "brain.repos.json"))).toBe(true);
    expect(readFileSync(join(dest, "brain.repos.json"), "utf8")).toContain("fixture");
    await expect(cloneWorkspaceRepo(world.remotes["."] as string, dest)).rejects.toThrow(
      /already has files/,
    );
    await expect(cloneWorkspaceRepo("", dest)).rejects.toThrow(/git URL/);
    await expect(
      cloneWorkspaceRepo(join(world.root, "missing.git"), join(tmp(), "x")),
    ).rejects.toThrow(/clone failed/);
  });
});
