import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { type: string; payload: unknown }) => void;

const handlers = new Map<string, Set<Handler>>();
const frames: Array<() => void> = [];
let answers: Record<string, unknown> = {};
let gate: Promise<void> | null = null;
const invoke = vi.fn(async (channel: string) => {
  if (gate) await gate;
  return answers[channel];
});

// The renderer's modules read these when they load, so they are in place before the first import.
Object.assign(globalThis, {
  window: {
    office: {
      invoke,
      on: (type: string, cb: Handler) => {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)?.add(cb);
        return () => handlers.get(type)?.delete(cb);
      },
    },
  },
  requestAnimationFrame: (cb: () => void) => frames.push(cb),
  cancelAnimationFrame: () => undefined,
});

const emit = (type: string): void => handlers.get(type)?.forEach((cb) => cb({ type, payload: {} }));
const flushFrame = (): void => frames.splice(0).forEach((cb) => cb());
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function load() {
  const query = await import("../../src/renderer/src/lib/query");
  const ipc = await import("../../src/renderer/src/lib/ipc");
  return { ...query, ...ipc };
}

beforeEach(async () => {
  const { clearQueryCache } = await load();
  clearQueryCache();
  invoke.mockClear();
  handlers.clear();
  frames.length = 0;
  gate = null;
  answers = { "projects.list": [{ id: "a" }], "sessions.list": [] };
});

describe("the query cache", () => {
  it("is loading only for a key that never had data; a key that has it answers at once", async () => {
    const { subscribeQuery, peekQuery } = await load();
    expect(peekQuery("projects.list").loading).toBe(true);
    const off = subscribeQuery("projects.list", undefined, [], () => undefined);
    await settle();
    expect(peekQuery("projects.list").data).toEqual([{ id: "a" }]);
    expect(peekQuery("projects.list").loading).toBe(false);
    off();

    // A second view of the same key finds the data waiting, with no loading, and the answer is asked for again.
    invoke.mockClear();
    answers["projects.list"] = [{ id: "a" }, { id: "b" }];
    const seen = vi.fn();
    const off2 = subscribeQuery("projects.list", undefined, [], seen);
    expect(peekQuery("projects.list").loading).toBe(false);
    expect(peekQuery("projects.list").data).toEqual([{ id: "a" }]);
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(peekQuery("projects.list").data).toEqual([{ id: "a" }, { id: "b" }]);
    expect(seen).toHaveBeenCalled();
    off2();
  });

  it("keeps the same data object when the answer did not change", async () => {
    const { subscribeQuery, peekQuery } = await load();
    const off = subscribeQuery("projects.list", undefined, ["project.status"], () => undefined);
    await settle();
    const first = peekQuery("projects.list").data;
    emit("project.status");
    flushFrame();
    await settle();
    expect(peekQuery("projects.list").data).toBe(first);
    off();
  });

  it("turns any number of events in one frame into one call", async () => {
    const { subscribeQuery } = await load();
    const off = subscribeQuery("projects.list", undefined, ["project.status"], () => undefined);
    await settle();
    invoke.mockClear();
    for (let i = 0; i < 25; i++) emit("project.status");
    expect(invoke).not.toHaveBeenCalled();
    flushFrame();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    off();
  });

  it("never runs two calls for one key at once: a request meanwhile makes one more after it", async () => {
    const { subscribeQuery } = await load();
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => (release = resolve));
    const off = subscribeQuery("projects.list", undefined, ["project.status"], () => undefined);
    emit("project.status");
    flushFrame();
    emit("project.status");
    flushFrame();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    gate = null;
    release();
    await settle();
    flushFrame();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(2);
    off();
  });

  it("listens to an event only while a view needs it", async () => {
    const { subscribeQuery } = await load();
    const off = subscribeQuery("projects.list", undefined, ["project.status"], () => undefined);
    expect(handlers.get("project.status")?.size).toBe(1);
    const off2 = subscribeQuery("sessions.list", undefined, ["project.status"], () => undefined);
    expect(handlers.get("project.status")?.size).toBe(1);
    off();
    off2();
    expect(handlers.get("project.status")?.size ?? 0).toBe(0);
  });

  it("keys by payload, so two payloads are two entries", async () => {
    const { subscribeQuery, peekQuery } = await load();
    answers["sessions.list"] = ["all"];
    const off = subscribeQuery("sessions.list", {}, [], () => undefined);
    await settle();
    expect(peekQuery("sessions.list", {}).data).toEqual(["all"]);
    expect(peekQuery("sessions.list", { projectId: "a" }).loading).toBe(true);
    off();
  });

  it("asks the open queries again after a call that changes something, and not after a read", async () => {
    const { subscribeQuery, office } = await load();
    const off = subscribeQuery("projects.list", undefined, [], () => undefined);
    await settle();
    invoke.mockClear();

    await office.invoke("layout.set", { key: "x", layout: {} } as never);
    flushFrame();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1); // the layout call itself: it is quiet

    invoke.mockClear();
    await office.invoke("projects.get", { id: "a" });
    flushFrame();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1); // a read: no revalidation

    invoke.mockClear();
    await office.invoke("sessions.kill", { id: "s" });
    flushFrame();
    await settle();
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["sessions.kill", "projects.list"]);
    off();
  });

  it("prefetch reads ahead, so the view finds the answer waiting", async () => {
    const { prefetch, peekQuery, subscribeQuery } = await load();
    prefetch("projects.list");
    await settle();
    expect(peekQuery("projects.list").data).toEqual([{ id: "a" }]);
    const off = subscribeQuery("projects.list", undefined, [], () => undefined);
    expect(peekQuery("projects.list").loading).toBe(false);
    off();
  });
});
