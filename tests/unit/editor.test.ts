import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "../../src/main/core/workspace";
import { WorkspaceEditor } from "../../src/main/modules/tasks/editor";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import { sh } from "../fixtures/repos/make";
import { makeWorld } from "../fixtures/vault/make";

async function setup() {
  const world = makeWorld();
  const store = new WorkspaceStore();
  await store.open(world.hub, world.workspaceConfigPath);
  const writer = new VaultWriter({ hubRoot: () => world.hub, onWarning: () => undefined });
  const editor = new WorkspaceEditor({
    writer,
    workspaceFile: () => store.filePath,
    reload: () => void store.reload(),
  });
  const file = join(world.hub, world.workspaceConfigPath);
  return { world, store, editor, file };
}

describe("role editing", () => {
  it("round-trips a role through the file, validation and a commit", async () => {
    const { world, store, editor, file } = await setup();
    await editor.saveRole("qa", {
      provider: "fake",
      model: "haiku",
      effort: "low",
      instructions: "Test everything.",
      readOnly: true,
    });
    expect(store.state.workspace?.roles["qa"]).toEqual({
      provider: "fake",
      model: "haiku",
      effort: "low",
      instructions: "Test everything.",
      readOnly: true,
    });
    expect(JSON.parse(readFileSync(file, "utf8")).roles.qa.model).toBe("haiku");
    expect(sh(join(world.hub, "Office"), "log", "-1", "--format=%s").trim()).toBe(
      "Workspace: update role qa",
    );
    expect(sh(world.remotes["Office"] as string, "log", "-1", "--format=%s").trim()).toBe(
      "Workspace: update role qa",
    );

    // Editing an existing role changes only that role.
    const before = store.state.workspace?.roles["builder"];
    await editor.saveRole("planner", {
      provider: "claude-code",
      model: "opus",
      effort: "max",
      instructions: "Plan.",
      readOnly: false,
      permissionMode: "plan",
    });
    expect(store.state.workspace?.roles["planner"]?.effort).toBe("max");
    expect(store.state.workspace?.roles["builder"]).toEqual(before);
    await store.close();
  });

  it("rejects invalid roles before anything is written", async () => {
    const { store, editor, file } = await setup();
    const original = readFileSync(file, "utf8");
    await expect(
      editor.saveRole("bad", { provider: "fake", effort: "ultra" } as never),
    ).rejects.toThrow(/not valid/);
    await expect(
      editor.saveRole("Bad Id", { provider: "fake", instructions: "", readOnly: false }),
    ).rejects.toThrow(/lowercase/);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(store.state.error).toBeNull();
    await store.close();
  });

  it("refuses to remove a role that a pipeline or an override still uses, and removes a free one", async () => {
    const { store, editor } = await setup();
    await expect(editor.removeRole("planner")).rejects.toThrow(/used by the "feature" pipeline/);
    await editor.saveRole("scratch", { provider: "fake", instructions: "", readOnly: false });
    await editor.setOverride("alpha", "builder", "scratch");
    await expect(editor.removeRole("scratch")).rejects.toThrow(/used by a project override/);
    await editor.setOverride("alpha", "builder", null);
    await editor.removeRole("scratch");
    expect(store.state.workspace?.roles["scratch"]).toBeUndefined();
    await store.close();
  });

  it("sets and clears a project override, validating the target", async () => {
    const { store, editor } = await setup();
    await expect(editor.setOverride("alpha", "builder", "ghost")).rejects.toThrow(/no role called/);
    await expect(editor.setOverride("nope", "builder", "reviewer")).rejects.toThrow(/No project/);
    await editor.setOverride("alpha", "builder", "researcher");
    expect(store.state.workspace?.projects.find((p) => p.id === "alpha")?.roles).toEqual({
      builder: "researcher",
    });
    await editor.setOverride("alpha", "builder", null);
    expect(store.state.workspace?.projects.find((p) => p.id === "alpha")?.roles).toBeUndefined();
    await store.close();
  });
});
