import { describe, expect, it } from "vitest";
import type { ToolStatus } from "../../src/shared/models";
import { computeSetupState, toolsReason } from "../../src/main/modules/setup/state";

const tool = (id: string, installed: boolean, loggedIn: boolean | null = null): ToolStatus => ({
  id,
  label: id,
  installed,
  loggedIn,
});
const READY = [tool("git", true), tool("claude-code", true, true), tool("codex", false)];

const base = {
  settings: {
    workspaceRoot: "/ws",
    workspaceConfigPath: "Office/workspace.json",
    projectsRoot: "/projects",
    welcomeDone: true,
  },
  workspaceError: null,
  tools: READY,
  hooksInstalled: false,
  isDir: () => true,
  fileExists: () => true,
};

describe("the tools step", () => {
  it("waits for the first look", () => {
    expect(toolsReason(null)).toContain("Checking");
  });
  it("needs Git", () => {
    expect(toolsReason([tool("git", false), tool("claude-code", true, true)])).toContain("Git");
  });
  it("needs an agent tool, then a login", () => {
    expect(toolsReason([tool("git", true), tool("claude-code", false), tool("codex", false)])).toContain(
      "Install Claude Code or Codex",
    );
    expect(toolsReason([tool("git", true), tool("claude-code", true, false)])).toContain("Log in");
    expect(toolsReason([tool("git", true), tool("claude-code", true, false), tool("codex", true, true)])).toBeNull();
  });
});

describe("computeSetupState", () => {
  it("opens the app when everything is met and the flow was finished", () => {
    const state = computeSetupState(base);
    expect(state.welcome).toBe(false);
    expect(state.steps.map((s) => [s.id, s.met])).toEqual([
      ["workspace", true],
      ["projects", true],
      ["tools", true],
      ["notifications", false],
    ]);
  });

  it("shows the welcome flow on a first run, at the first step that is not met", () => {
    const state = computeSetupState({
      ...base,
      settings: { workspaceRoot: "", workspaceConfigPath: "", projectsRoot: "" },
      tools: null,
    });
    expect(state.welcome).toBe(true);
    expect(state.current).toBe("workspace");
    expect(state.steps[0]?.reason).toContain("Choose or clone");
  });

  it("goes on to the projects folder, then the tools", () => {
    const workspaceOnly = computeSetupState({
      ...base,
      settings: { ...base.settings, projectsRoot: "", welcomeDone: false },
    });
    expect(workspaceOnly.current).toBe("projects");
    const toolsMissing = computeSetupState({
      ...base,
      settings: { ...base.settings, welcomeDone: false },
      tools: [tool("git", true)],
    });
    expect(toolsMissing.current).toBe("tools");
    expect(toolsMissing.welcome).toBe(true);
  });

  it("opens on the tools step once the workspace and the projects folder are set, and the notifications step is optional", () => {
    const state = computeSetupState({ ...base, settings: { ...base.settings, welcomeDone: false } });
    expect(state.current).toBe("tools");
    expect(state.welcome).toBe(true);
    expect(state.steps[3]?.required).toBe(false);
  });

  it("sends the app back to the workspace step when its folder is gone", () => {
    const state = computeSetupState({ ...base, isDir: (p) => p !== "/ws" });
    expect(state.welcome).toBe(true);
    expect(state.current).toBe("workspace");
    expect(state.steps[0]?.reason).toContain("is gone");
  });

  it("sends the app back to the projects step when that folder is gone", () => {
    const state = computeSetupState({ ...base, isDir: (p) => p !== "/projects" });
    expect(state.welcome).toBe(true);
    expect(state.current).toBe("projects");
  });

  it("sends the app back when the config file is missing or broken", () => {
    expect(computeSetupState({ ...base, fileExists: () => false }).current).toBe("workspace");
    expect(computeSetupState({ ...base, workspaceError: "workspace.json is not valid" }).current).toBe(
      "workspace",
    );
  });

  it("does not lock the owner out when a tool login lapses after the flow was finished", () => {
    const state = computeSetupState({ ...base, tools: [tool("git", true), tool("claude-code", true, false)] });
    expect(state.welcome).toBe(false);
    expect(state.steps[2]?.met).toBe(false);
  });
});
