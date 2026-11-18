/**
 * A value that is slow to work out (it starts programs or walks folders), kept so reads never wait for it.
 * `get` answers with the last result at once; when that result is older than `staleMs` it is worked out again
 * behind the answer, and `onChange` tells the screens when the new one is in. Only a key that was never read
 * waits for its first result, which `warm` does ahead of time at start.
 */
export class BackgroundCache<K, T> {
  private readonly values = new Map<string, { value: T; at: number }>();
  private readonly inflight = new Map<string, Promise<T>>();
  /** Counts invalidations: a result worked out before the latest one is already out of date. */
  private epoch = 0;

  constructor(
    private readonly compute: (key: K) => Promise<T>,
    private readonly options: {
      keyOf: (key: K) => string;
      staleMs: number;
      onChange?: (key: K) => void;
    },
  ) {}

  get(key: K): Promise<T> | T {
    const id = this.options.keyOf(key);
    const have = this.values.get(id);
    if (!have) return this.refresh(key);
    if (Date.now() - have.at > this.options.staleMs) void this.refresh(key).catch(() => undefined);
    return have.value;
  }

  /** Works the value out now (one run at a time per key) and keeps it. */
  refresh(key: K): Promise<T> {
    const id = this.options.keyOf(key);
    const running = this.inflight.get(id);
    if (running) return running;
    const startedAt = this.epoch;
    const work = this.compute(key)
      .then((value) => {
        const changed = JSON.stringify(this.values.get(id)?.value) !== JSON.stringify(value);
        // Something changed while this was being worked out: keep it, but count it as old so the next read redoes it.
        this.values.set(id, { value, at: startedAt === this.epoch ? Date.now() : 0 });
        if (changed) this.options.onChange?.(key);
        return value;
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, work);
    return work;
  }

  /** Marks a key as old, so the next read works it out again behind its answer. */
  invalidate(key?: K): void {
    this.epoch++;
    if (key === undefined) {
      for (const entry of this.values.values()) entry.at = 0;
      return;
    }
    const have = this.values.get(this.options.keyOf(key));
    if (have) have.at = 0;
  }
}
