import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { ModuleManager } from "../../src/main/core/modules";
import { Notifier } from "../../src/main/core/notifier";
import type { Workspace } from "../../src/shared/types";

const repo = resolve(__dirname, "../..");

const workspace: Workspace = {
  version: 1,
  vault: { kind: "none", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
  projects: [],
  roles: {},
  pipelines: {},
  notifications: { urgent: ["agent.needs-you"], mutedProjects: [] },
  automations: [],
  archiveAfterDays: 7,
  briefTime: "08:00",
};

function setup(...modules: Array<[source: string, name: string]>) {
  const dir = mkdtempSync(join(tmpdir(), "office-modules-"));
  for (const [source, name] of modules)
    cpSync(join(repo, source), join(dir, name), { recursive: true });
  const flags: Record<string, boolean> = {};
  const db = openDb(":memory:");
  const notifier = new Notifier({
    db,
    bus: new Bus(),
    workspace: () => workspace,
    quietHours: () => undefined,
  });
  const logs: string[] = [];
  const manager = new ModuleManager({
    dir: () => dir,
    enabled: () => flags,
    setEnabled: (name, on) => void (flags[name] = on),
    workspace: () => workspace,
    targets: {
      addChannel: (c) => notifier.addChannel(c),
      removeChannel: (id) => notifier.removeChannel(id),
      addProvider: () => undefined,
      removeProvider: () => undefined,
    },
    log: (m) => logs.push(m),
  });
  return { dir, flags, notifier, manager, logs };
}

async function until(cond: () => boolean): Promise<void> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
}

describe("modules", () => {
  it("the sample channel module loads when enabled and receives an urgent notification", async () => {
    const { dir, manager, notifier, logs } = setup([
      "examples/modules/sample-channel",
      "sample-channel",
    ]);
    expect(manager.list()).toEqual([
      expect.objectContaining({
        name: "sample-channel",
        kind: "channel",
        enabled: false,
        loaded: false,
      }),
    ]);

    await manager.setEnabled("sample-channel", true);
    expect(manager.list()[0]).toMatchObject({ enabled: true, loaded: true });
    expect(logs).toContain("[module sample-channel] sample channel ready");

    notifier.notify({ kind: "agent.needs-you", title: "Needs you now", body: "b" });
    notifier.notify({ kind: "agent.done", title: "Calm" });
    const log = join(dir, "sample-channel", "data", "received.log");
    await until(() => existsSync(log));
    expect(readFileSync(log, "utf8")).toBe("agent.needs-you\tNeeds you now\n");

    // Turning it off removes the channel again.
    await manager.setEnabled("sample-channel", false);
    notifier.notify({ kind: "agent.needs-you", title: "After disable" });
    await new Promise((r) => setTimeout(r, 300));
    expect(readFileSync(log, "utf8")).toBe("agent.needs-you\tNeeds you now\n");
  });

  it("does not import a module's code until it is enabled", async () => {
    const { dir, manager } = setup(["tests/fixtures/modules/side-effect", "side-effect"]);
    manager.list();
    await manager.loadEnabled();
    expect(existsSync(join(dir, "side-effect", "imported.marker"))).toBe(false);
    await manager.setEnabled("side-effect", true);
    expect(existsSync(join(dir, "side-effect", "imported.marker"))).toBe(true);
  });

  it("loads enabled modules at start, adds source entries, and reports a broken module without crashing", async () => {
    const { flags, manager } = setup(
      ["tests/fixtures/modules/sample-source", "sample-source"],
      ["tests/fixtures/modules/broken", "broken"],
    );
    flags["sample-source"] = true;
    flags["broken"] = true;
    await manager.loadEnabled();
    const byName = Object.fromEntries(manager.list().map((m) => [m.name, m]));
    expect(byName["sample-source"]).toMatchObject({ kind: "source", loaded: true });
    expect(byName["broken"]).toMatchObject({
      enabled: true,
      loaded: false,
      error: "this module is broken on purpose",
    });
    const items = (await Promise.all(manager.searchSources().map((s) => s.items()))).flat();
    expect(items).toEqual([
      { kind: "note", label: "From the sample source", link: { view: "home" } },
    ]);
    await manager.setEnabled("sample-source", false);
    expect(manager.searchSources()).toEqual([]);
  });

  it("ignores folders without an index.mjs and refuses bad names", async () => {
    const { manager } = setup();
    expect(manager.list()).toEqual([]);
    await expect(manager.setEnabled("../escape", true)).rejects.toThrow(/Bad module name/);
  });
});
