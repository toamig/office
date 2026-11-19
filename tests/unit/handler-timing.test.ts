import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChannelName } from "../../src/shared/ipc";
import { READ_CHANNELS } from "../../src/shared/channel-kinds";
import type { AppContext } from "../../src/main/context";
import { makeWorld, type World } from "../fixtures/vault/make";

/** A read channel that answers in more than this has to move its slow part into a background job. */
const LIMIT_MS = 50;

/**
 * Reads that cannot be fast, each with its reason. A channel is only here when what it reads is a working tree or
 * a remote service that the screen asks about on purpose (a project's Git tab), and the answer is for that
 * moment: it is never asked for by opening Home, Projects, Agents, Inbox or any other overview.
 */
const ALLOWED_SLOW: Record<string, string> = {
  "git.status": "reads the working tree of one repo on demand, from the Git tab only",
  "diff.get": "runs git diff for the file list the owner is reviewing, from the Git tab only",
  "branches.list": "lists one repo's branches on demand, from the Git tab only",
  "branches.compare": "compares two branches the owner picked, from the Git tab only",
  "worktrees.list": "lists the worktrees of the repos on demand, from the Git tab only",
};

const ROOT = resolve(__dirname, "../..");
let ctx: AppContext;
let world: World;
const saved: Record<string, string | undefined> = {};

const payloads = (w: World): Partial<Record<ChannelName, unknown>> => ({
  "app.ping": { text: "x" },
  "projects.get": { id: "alpha" },
  "vault.openItems": { projectId: "alpha" },
  "projects.runs": { id: "alpha" },
  "projects.unrealFile": { id: "alpha" },
  "notes.read": { projectId: "alpha", name: "Overview.md" },
  "setup.inspect": { root: w.hub },
  "setup.inventory": {},
  "sessions.list": {},
  "sessions.history": { id: "none" },
  "layout.get": { key: "all" },
  "hooks.preview": { target: "claude", action: "install" },
  "ask.result": { runId: "none" },
  "vault.readFile": { path: join(w.hub, "Alpha", "OpenItems.md") },
  "branches.list": { projectId: "alpha" },
  "branches.compare": { projectId: "alpha", a: "main", b: "main" },
  "worktrees.list": {},
  "diff.get": { projectId: "alpha", mode: "working" },
  "git.status": { projectId: "alpha" },
  "github.overview": { projectId: "alpha" },
  "chat.state": { id: "none" },
  "chat.history": { id: "none" },
  "chat.files": { id: "none", query: "" },
  "tasks.list": {},
  "tasks.get": { id: "none" },
  "pending.list": {},
});

beforeAll(async () => {
  for (const key of [
    "OFFICE_DATA",
    "OFFICE_HOME",
    "OFFICE_BIN_CLAUDE",
    "OFFICE_BIN_CODEX",
    "OFFICE_BIN_GH",
  ])
    saved[key] = process.env[key];
  const base = mkdtempSync(join(tmpdir(), "office-timing-"));
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  cpSync(join(ROOT, "tests/fixtures/home"), home, { recursive: true });
  process.env["OFFICE_DATA"] = join(base, "data");
  process.env["OFFICE_HOME"] = home;
  process.env["OFFICE_BIN_CLAUDE"] = join(ROOT, "tests/fixtures/bin/fake-claude.mjs");
  process.env["OFFICE_BIN_CODEX"] = join(ROOT, "tests/fixtures/bin/fake-codex.mjs");
  process.env["OFFICE_BIN_GH"] = join(ROOT, "tests/fixtures/bin/fake-gh.mjs");
  world = makeWorld();
  mkdirSync(process.env["OFFICE_DATA"], { recursive: true });
  writeFileSync(
    join(process.env["OFFICE_DATA"], "settings.json"),
    JSON.stringify({
      version: 1,
      workspaceRoot: world.hub,
      workspaceConfigPath: world.workspaceConfigPath,
      projectsRoot: world.projectsRoot,
      relay: { port: 0, token: "timing" },
      welcomeDone: true,
    }),
  );
  const { createContext } = await import("../../src/main/context");
  const { registerHandlers } = await import("../../src/main/handlers");
  ctx = await createContext(true, join(ROOT, "resources/relay/office-relay.mjs"));
  registerHandlers(ctx);
  await ctx.start();
  // The background jobs have run once, as they do at start: reads afterwards come from their results.
  await Promise.all([ctx.health.refresh(), ctx.toolsMonitor.check(), ctx.projects.refreshAll()]);
});

afterAll(async () => {
  await ctx?.stop();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function time(channel: ChannelName, payload: unknown): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await ctx.ipc.dispatch(channel, payload);
    runs.push(performance.now() - start);
  }
  // The fastest of three: a slow machine or a busy moment must not fail a handler that is quick.
  return Math.min(...runs);
}

describe("read channels answer from memory or the database", () => {
  it("every read channel answers in under 50 ms against the fixtures, except the listed ones", async () => {
    const given = payloads(world);
    // Other test files run at the same time, so a channel that looks slow is measured again, alone, before it counts.
    let suspects: ChannelName[] = READ_CHANNELS.filter((c) => !(c in ALLOWED_SLOW));
    const slow: string[] = [];
    for (let attempt = 0; attempt < 4 && suspects.length > 0; attempt++) {
      const still: ChannelName[] = [];
      slow.length = 0;
      for (const channel of suspects) {
        const ms = await time(channel, given[channel]);
        if (ms > LIMIT_MS) {
          still.push(channel);
          slow.push(`${channel} took ${ms.toFixed(0)} ms`);
        }
      }
      suspects = still;
    }
    expect(slow).toEqual([]);
  });

  it("every allowed slow channel has a reason, and is a real read channel", () => {
    for (const [channel, reason] of Object.entries(ALLOWED_SLOW)) {
      expect(READ_CHANNELS).toContain(channel);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("vault.health never runs the brain checks: only its background job does", async () => {
    let runs = 0;
    const real = ctx.health.refresh.bind(ctx.health);
    ctx.health.refresh = () => {
      runs++;
      return real();
    };
    for (let i = 0; i < 30; i++) await ctx.ipc.dispatch("vault.health", undefined);
    expect(runs).toBe(0);
    await ctx.health.refresh();
    expect(runs).toBe(1);
    const view = (await ctx.ipc.dispatch("vault.health", undefined)) as {
      ok: true;
      data: { checkedAt: string | null };
    };
    expect(view.data.checkedAt).not.toBeNull();
  });
});
