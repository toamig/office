import { describe, expect, it } from "vitest";
import { badgePng } from "../../src/main/core/badge";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { inQuietHours, Notifier } from "../../src/main/core/notifier";
import { syncAll } from "../../src/main/modules/git/syncall";
import { notifyFromSyncReport, WaitingWatcher } from "../../src/main/modules/notify/sources";
import { VaultService } from "../../src/main/modules/vault/service";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type { Workspace } from "../../src/shared/types";
import { makeConflict, makeRepoPair } from "../fixtures/repos/make";
import { makeWorld } from "../fixtures/vault/make";

const workspace = (over: Partial<Workspace["notifications"]> = {}): Workspace => ({
  version: 1,
  vault: { kind: "none", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
  projects: [],
  roles: {},
  pipelines: {},
  notifications: { urgent: ["git.conflict", "task.gate"], mutedProjects: [], ...over },
  automations: [],
  archiveAfterDays: 7,
  briefTime: "08:00",
});

function make(
  opts: { ws?: Workspace; quiet?: { from: string; to: string }; now?: () => Date } = {},
) {
  const sent: string[] = [];
  const bus = new Bus();
  const notifier = new Notifier({
    db: openDb(":memory:"),
    bus,
    workspace: () => opts.ws ?? workspace(),
    quietHours: () => opts.quiet,
    ...(opts.now ? { now: opts.now } : {}),
    channels: [{ id: "test", send: (n) => void sent.push(n.title) }],
  });
  return { notifier, sent };
}

describe("notifier", () => {
  it("stores a row, marks urgency from the workspace config and sends urgent ones to channels", () => {
    const { notifier, sent } = make();
    const urgent = notifier.notify({ kind: "git.conflict", projectId: "a", title: "Conflict" });
    const calm = notifier.notify({ kind: "agent.done", projectId: "a", title: "Done" });
    expect(urgent.urgent).toBe(true);
    expect(calm.urgent).toBe(false);
    expect(sent).toEqual(["Conflict"]);
    expect(notifier.list()).toHaveLength(2);
  });

  it("deduplicates the same kind, project and title inside ten minutes", () => {
    let t = new Date("2026-11-19T10:00:00Z");
    const { notifier, sent } = make({ now: () => t });
    const first = notifier.notify({
      kind: "git.conflict",
      projectId: "a",
      title: "Conflict",
      body: "one",
    });
    t = new Date("2026-11-19T10:05:00Z");
    const second = notifier.notify({
      kind: "git.conflict",
      projectId: "a",
      title: "Conflict",
      body: "two",
    });
    expect(second.id).toBe(first.id);
    expect(second.body).toBe("two");
    expect(notifier.list()).toHaveLength(1);
    expect(sent).toEqual(["Conflict"]);
    t = new Date("2026-11-19T10:20:00Z");
    expect(
      notifier.notify({ kind: "git.conflict", projectId: "a", title: "Conflict" }).id,
    ).not.toBe(first.id);
    // Only what the alert rules need is kept: the old row is gone once the window has passed.
    expect(notifier.list()).toHaveLength(1);
  });

  it("does not raise alerts for muted projects or during quiet hours, but still stores them", () => {
    const muted = make({ ws: workspace({ mutedProjects: ["a"] }) });
    muted.notifier.notify({ kind: "git.conflict", projectId: "a", title: "Muted" });
    expect(muted.sent).toEqual([]);
    expect(muted.notifier.list()).toHaveLength(1);

    const quiet = make({
      quiet: { from: "22:00", to: "07:00" },
      now: () => new Date(2026, 10, 19, 23, 30),
    });
    quiet.notifier.notify({ kind: "git.conflict", title: "Night" });
    expect(quiet.sent).toEqual([]);
    expect(quiet.notifier.list()).toHaveLength(1);
  });
});

describe("quiet hours", () => {
  it("handles windows that wrap midnight and ones that do not", () => {
    const at = (h: number, m = 0): Date => new Date(2026, 10, 19, h, m);
    expect(inQuietHours(at(23), { from: "22:00", to: "07:00" })).toBe(true);
    expect(inQuietHours(at(3), { from: "22:00", to: "07:00" })).toBe(true);
    expect(inQuietHours(at(12), { from: "22:00", to: "07:00" })).toBe(false);
    expect(inQuietHours(at(13), { from: "12:00", to: "14:00" })).toBe(true);
    expect(inQuietHours(at(15), { from: "12:00", to: "14:00" })).toBe(false);
    expect(inQuietHours(at(15), undefined)).toBe(false);
  });
});

describe("notification sources", () => {
  it("a fixture conflict raises one urgent notification and repeats deduplicate", async () => {
    const pair = makeRepoPair();
    makeConflict(pair);
    const { notifier, sent } = make();
    const deps = {
      workspaceRoot: () => pair.root,
      projectsRoot: () => pair.root,
      workspace: () => ({
        ...workspace(),
        projects: [{ id: "p", name: "P", path: pair.work, pinned: false, archived: false }],
      }),
    };
    notifyFromSyncReport(notifier, await syncAll(deps));
    notifyFromSyncReport(notifier, await syncAll(deps));
    const rows = notifier.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "git.conflict", urgent: true, projectId: "p" });
    expect(rows[0]?.link).toEqual({ view: "project", params: { id: "p" } });
    expect(sent).toEqual(["Sync conflict in P"]);
  });

  it("raises vault.waiting-new only for items added after the first snapshot", () => {
    const world = makeWorld();
    const loaded = loadWorkspaceFile(join(world.hub, world.workspaceConfigPath));
    if (!loaded.ok) throw new Error(loaded.error);
    const vault = new VaultService({
      bus: new Bus(),
      workspace: () => loaded.workspace,
      workspaceRoot: () => world.hub,
    });
    const { notifier } = make();
    const watcher = new WaitingWatcher(vault, notifier, () => loaded.workspace.projects);
    watcher.prime();
    watcher.check();
    expect(notifier.list()).toHaveLength(0);
    const file = vault.openItemsFile("alpha") as string;
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "## Todo",
        "- [ ] 2026-11-19 A brand new thing\n\n## Todo",
      ),
    );
    watcher.check();
    expect(notifier.list().map((n) => [n.kind, n.body])).toEqual([
      ["vault.waiting-new", "A brand new thing"],
    ]);
  });
});

describe("badge", () => {
  it("produces a valid 16x16 PNG", () => {
    const png = badgePng(3);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(16);
    expect(png.readUInt32BE(20)).toBe(16);
    expect(badgePng(12).length).toBeGreaterThan(40);
  });
});
