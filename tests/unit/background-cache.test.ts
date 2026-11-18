import { describe, expect, it, vi } from "vitest";
import { BackgroundCache } from "../../src/main/core/background-cache";

function make(staleMs = 1000) {
  let n = 0;
  const compute = vi.fn(async () => ++n);
  const changed = vi.fn();
  const cache = new BackgroundCache<string, number>(compute, {
    keyOf: (k) => k,
    staleMs,
    onChange: changed,
  });
  return { cache, compute, changed };
}

describe("BackgroundCache", () => {
  it("waits only for the first result, then answers at once", async () => {
    const { cache, compute } = make();
    expect(await cache.get("a")).toBe(1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("a")).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("works a stale value out again behind the answer", async () => {
    vi.useFakeTimers();
    const { cache, compute, changed } = make(1000);
    await cache.get("a");
    vi.advanceTimersByTime(1500);
    expect(cache.get("a")).toBe(1); // the old answer, at once
    await vi.advanceTimersByTimeAsync(0);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(cache.get("a")).toBe(2);
    expect(changed).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("never works one key out twice at once", async () => {
    const { cache, compute } = make();
    await Promise.all([cache.get("a"), cache.get("a"), cache.refresh("a")]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("counts a result as old when an invalidation came while it was being worked out", async () => {
    let release: () => void = () => undefined;
    let n = 0;
    const compute = vi.fn(async () => {
      const mine = ++n;
      if (mine === 1) await new Promise<void>((r) => (release = r));
      return mine;
    });
    const cache = new BackgroundCache<string, number>(compute, {
      keyOf: (k) => k,
      staleMs: 60_000,
    });
    const first = cache.refresh("a");
    cache.invalidate();
    release();
    await first;
    // The first result is kept, but the next read redoes it.
    expect(cache.get("a")).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
