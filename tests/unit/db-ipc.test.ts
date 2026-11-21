import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { migrate, openDb } from "../../src/main/core/db";
import { IpcFailure, IpcRegistry } from "../../src/main/core/ipc";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "office-db-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("database", () => {
  it("runs migrations on a temp file twice without error", () => {
    const path = join(tmp, "office.db");
    const first = openDb(path);
    first.close();
    const second = openDb(path);
    expect(migrate(second)).toEqual([]);
    expect(second.prepare("PRAGMA table_info(sessions)").all()).toContainEqual(
      expect.objectContaining({ name: "autonomy", type: "TEXT" }),
    );
    const tables = second
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      "sessions",
      "runs",
      "notifications",
      "tasks",
      "task_stages",
      "briefs",
      "layouts",
      "automations_log",
    ]) {
      expect(tables).toContain(t);
    }
    second.close();
  });
});

describe("bus", () => {
  it("delivers typed events to specific and wildcard listeners", () => {
    const bus = new Bus();
    const seen: string[] = [];
    bus.on("vault.changed", (e) => seen.push(`one:${e.type}`));
    bus.on("*", (e) => seen.push(`all:${e.type}:${e.projectId}`));
    bus.emit("vault.changed", {}, "p1");
    bus.emit("task.changed", {});
    expect(seen).toEqual([
      "one:vault.changed",
      "all:vault.changed:p1",
      "all:task.changed:undefined",
    ]);
  });
});

describe("ipc registry", () => {
  it("validates requests, responses and reports errors without stacks", async () => {
    const ipc = new IpcRegistry(true);
    ipc.handle("app.ping", (req) => ({ text: req.text, at: "now" }));
    expect(await ipc.dispatch("app.ping", { text: "hi" })).toEqual({
      ok: true,
      data: { text: "hi", at: "now" },
    });
    expect(await ipc.dispatch("app.ping", { text: 1 })).toMatchObject({
      ok: false,
      error: { code: "bad-request" },
    });
    expect(await ipc.dispatch("nope", {})).toMatchObject({
      ok: false,
      error: { code: "unknown-channel" },
    });
    expect(await ipc.dispatch("workspace.get", undefined)).toMatchObject({
      error: { code: "no-handler" },
    });

    ipc.handle("app.ping", () => {
      throw new IpcFailure("custom", "Readable message");
    });
    expect(await ipc.dispatch("app.ping", { text: "x" })).toEqual({
      ok: false,
      error: { code: "custom", message: "Readable message" },
    });
    ipc.handle("app.ping", () => ({ wrong: true }) as never);
    expect(await ipc.dispatch("app.ping", { text: "x" })).toMatchObject({
      error: { code: "bad-response" },
    });
  });
});
