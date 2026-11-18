import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataDir, settingsPath, userHome } from "../../src/main/core/paths";
import { isConfigured, loadSettings, saveSettings } from "../../src/main/core/settings";
import { loadWorkspaceFile, WorkspaceStore } from "../../src/main/core/workspace";

const example = resolve(__dirname, "../../examples/workspace.example.json");
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "office-ws-"));
});
afterEach(() => {
  delete process.env["OFFICE_HOME"];
  delete process.env["OFFICE_DATA"];
  delete process.env["OFFICE_WORKSPACE"];
  rmSync(tmp, { recursive: true, force: true });
});

describe("paths", () => {
  it("honours the OFFICE_* overrides", () => {
    process.env["OFFICE_HOME"] = join(tmp, "home");
    process.env["OFFICE_DATA"] = join(tmp, "data");
    expect(userHome()).toBe(join(tmp, "home"));
    expect(dataDir()).toBe(join(tmp, "data"));
    expect(settingsPath()).toBe(join(tmp, "data", "settings.json"));
  });
});

describe("settings", () => {
  it("creates defaults with a relay token on first run and keeps them", () => {
    process.env["OFFICE_DATA"] = join(tmp, "data");
    const first = loadSettings();
    expect(first.relay.token).toHaveLength(64);
    expect(isConfigured(first)).toBe(false);
    saveSettings({ ...first, workspaceRoot: "a", workspaceConfigPath: "b", projectsRoot: "c" });
    const second = loadSettings();
    expect(second.relay.token).toBe(first.relay.token);
    expect(isConfigured(second)).toBe(true);
  });

  it("lets OFFICE_WORKSPACE override the workspace root", () => {
    process.env["OFFICE_DATA"] = join(tmp, "data");
    process.env["OFFICE_WORKSPACE"] = join(tmp, "ws");
    expect(loadSettings().workspaceRoot).toBe(join(tmp, "ws"));
  });
});

describe("workspace config", () => {
  it("accepts the example file", () => {
    const result = loadWorkspaceFile(example);
    expect(result.ok).toBe(true);
  });

  it("rejects invalid JSON and invalid shape with a readable message", () => {
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, "{ nope");
    expect(loadWorkspaceFile(bad)).toMatchObject({ ok: false });
    writeFileSync(bad, JSON.stringify({ version: 1 }));
    const result = loadWorkspaceFile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("failed validation");
  });

  it("reports a missing file without throwing", () => {
    expect(loadWorkspaceFile(join(tmp, "missing.json")).ok).toBe(false);
  });

  it("reloads on change and keeps the last good copy when the file turns invalid", async () => {
    writeFileSync(join(tmp, "w.json"), readFileSync(example));
    const store = new WorkspaceStore();
    await store.open(tmp, "w.json");
    expect(store.state.workspace?.projects).toHaveLength(2);

    const changed = JSON.parse(readFileSync(example, "utf8"));
    changed.projects.pop();
    const seen: Array<number | undefined> = [];
    store.subscribe((s) => seen.push(s.workspace?.projects.length));
    writeFileSync(join(tmp, "w.json"), JSON.stringify(changed));
    await waitFor(() => store.state.workspace?.projects.length === 1);

    writeFileSync(join(tmp, "w.json"), "{ broken");
    await waitFor(() => store.state.error !== null);
    expect(store.state.workspace?.projects).toHaveLength(1);
    await store.close();
  });

  it("validates before saving", async () => {
    writeFileSync(join(tmp, "w.json"), readFileSync(example));
    const store = new WorkspaceStore();
    await store.open(tmp, "w.json");
    const ws = store.state.workspace!;
    store.save({ ...ws, archiveAfterDays: 3 });
    expect(store.state.workspace?.archiveAfterDays).toBe(3);
    expect(() => store.save({ ...ws, version: 2 } as never)).toThrow();
    await store.close();
  });
});

describe("owner seed", () => {
  it("validates when present in the workspace repo", () => {
    const seed = process.env["OFFICE_SEED_FILE"];
    if (!seed) return;
    expect(loadWorkspaceFile(seed).ok).toBe(true);
  });
});

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for condition");
}

describe("the example workspace", () => {
  it("lets the builder role edit files in a headless run, and keeps the planner read only by mode", () => {
    const loaded = loadWorkspaceFile(example);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.workspace.roles["builder"]?.permissionMode).toBe("acceptEdits");
    expect(loaded.workspace.roles["builder"]?.readOnly).toBe(false);
    expect(loaded.workspace.roles["planner"]?.permissionMode).toBe("plan");
  });
});
