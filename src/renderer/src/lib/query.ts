import { useCallback, useSyncExternalStore } from "react";
import type { ChannelName, ChannelReq, ChannelRes, EventType } from "@shared/ipc";
import { onMutation, rawOffice } from "./ipc";

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  /** True only for a key that has never had data: a view that was open before shows what it showed. */
  loading: boolean;
  /** Asks again now. */
  reload: () => void;
}

/** One cached read: a channel and its payload. */
interface Entry {
  key: string;
  channel: ChannelName;
  payload: unknown;
  data: unknown;
  hasData: boolean;
  error: string | null;
  settled: boolean;
  inflight: boolean;
  again: boolean;
  frame: number | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  refs: number;
  usedAt: number;
  listeners: Set<() => void>;
  events: Map<EventType, number>;
  snap: Query<unknown>;
  reload: () => void;
}

const MAX_ENTRIES = 400;
/** How long a request waits for a frame before the timer asks instead. */
const FALLBACK_MS = 60;
const entries = new Map<string, Entry>();
/** Entries that open views are watching, by the events that make them ask again. */
const watchers = new Map<EventType, Set<Entry>>();
const eventOffs = new Map<EventType, () => void>();

const keyOf = (channel: string, payload: unknown): string =>
  `${channel}\u0000${JSON.stringify(payload ?? null)}`;

function snapshot(e: Entry): Query<unknown> {
  return {
    data: e.hasData ? e.data : undefined,
    error: e.error,
    loading: !e.hasData && !e.settled,
    reload: e.reload,
  };
}

function publish(e: Entry): void {
  e.snap = snapshot(e);
  e.listeners.forEach((l) => l());
}

function prune(): void {
  if (entries.size <= MAX_ENTRIES) return;
  const idle = [...entries.values()]
    .filter((e) => e.refs === 0)
    .sort((a, b) => a.usedAt - b.usedAt);
  for (const e of idle.slice(0, entries.size - MAX_ENTRIES)) entries.delete(e.key);
}

/** The cache entry of a channel and payload, made when first asked for. */
function entryFor(channel: ChannelName, payload: unknown): Entry {
  const key = keyOf(channel, payload);
  const have = entries.get(key);
  if (have) {
    have.usedAt = Date.now();
    return have;
  }
  const e: Entry = {
    key,
    channel,
    payload,
    data: undefined,
    hasData: false,
    error: null,
    settled: false,
    inflight: false,
    again: false,
    frame: null,
    timer: undefined,
    refs: 0,
    usedAt: Date.now(),
    listeners: new Set(),
    events: new Map(),
    snap: { data: undefined, error: null, loading: true, reload: () => undefined },
    reload: () => fetchNow(e),
  };
  e.snap = snapshot(e);
  entries.set(key, e);
  prune();
  return e;
}

/** Reads now. One call per key at a time: a request that comes in meanwhile makes one more call after it. */
function fetchNow(e: Entry): void {
  if (e.inflight) {
    e.again = true;
    return;
  }
  e.inflight = true;
  const call = rawOffice.invoke as (c: ChannelName, p?: unknown) => Promise<unknown>;
  call(e.channel, e.payload).then(
    (result) => {
      // The same answer keeps the same object, so nothing that shows it draws again.
      if (!e.hasData || JSON.stringify(e.data) !== JSON.stringify(result)) e.data = result;
      e.hasData = true;
      e.error = null;
      e.settled = true;
      finish(e);
    },
    (err: Error) => {
      e.error = err.message;
      e.settled = true;
      finish(e);
    },
  );
}

function finish(e: Entry): void {
  e.inflight = false;
  publish(e);
  if (e.again) {
    e.again = false;
    schedule(e);
  }
}

/**
 * Asks again at the next frame; any number of requests before then are one call. A frame does not come while the
 * window is hidden or the machine is busy, so a short timer is the fallback that keeps the data from going stale.
 */
function schedule(e: Entry): void {
  if (e.frame !== null) return;
  const run = (): void => {
    if (e.frame === null) return;
    cancelAnimationFrame(e.frame);
    clearTimeout(e.timer);
    e.frame = null;
    fetchNow(e);
  };
  e.frame = requestAnimationFrame(run);
  e.timer = setTimeout(run, FALLBACK_MS);
}

function watch(e: Entry, type: EventType): void {
  e.events.set(type, (e.events.get(type) ?? 0) + 1);
  let set = watchers.get(type);
  if (!set) {
    set = new Set();
    watchers.set(type, set);
    eventOffs.set(
      type,
      rawOffice.on(type, () => watchers.get(type)?.forEach(schedule)),
    );
  }
  set.add(e);
}

function unwatch(e: Entry, type: EventType): void {
  const left = (e.events.get(type) ?? 1) - 1;
  if (left > 0) return void e.events.set(type, left);
  e.events.delete(type);
  const set = watchers.get(type);
  set?.delete(e);
  if (set && set.size === 0) {
    watchers.delete(type);
    eventOffs.get(type)?.();
    eventOffs.delete(type);
  }
}

/** A view starts showing an entry: it hears about changes and the cached answer is asked for again at once. */
function attach(e: Entry, listener: () => void, types: EventType[]): () => void {
  e.refs++;
  e.listeners.add(listener);
  for (const type of types) watch(e, type);
  fetchNow(e);
  return () => {
    e.refs--;
    e.listeners.delete(listener);
    for (const type of types) unwatch(e, type);
  };
}

/** What the cache holds for a channel and payload right now. */
export function peekQuery(channel: ChannelName, payload?: unknown): Query<unknown> {
  return entryFor(channel, payload).snap;
}

/** Shows a query to a listener, outside React: what `useQuery` does on mount. Returns the way to stop. */
export function subscribeQuery(
  channel: ChannelName,
  payload: unknown,
  refreshOn: EventType[],
  listener: () => void,
): () => void {
  return attach(entryFor(channel, payload), listener, refreshOn);
}

/** Reads a channel ahead of its view, so the view finds the answer waiting. */
export function prefetch<C extends ChannelName>(channel: C, payload?: ChannelReq<C>): void {
  const e = entryFor(channel, payload);
  if (!e.inflight && !e.hasData) fetchNow(e);
  else if (!e.inflight) schedule(e);
}

/** Asks again every query that an open view is showing (after a call that changed something). */
export function invalidateMounted(): void {
  for (const e of entries.values()) if (e.refs > 0) schedule(e);
}

onMutation(invalidateMounted);

/** Forgets everything cached. Used by tests. */
export function clearQueryCache(): void {
  for (const e of entries.values()) {
    if (e.frame !== null) cancelAnimationFrame(e.frame);
    clearTimeout(e.timer);
  }
  entries.clear();
}

/**
 * Reads an IPC channel through one cache for the whole window, keyed by channel and payload. A key that has
 * data returns it at once and asks again in the background (stale while revalidate): `loading` is true only for a
 * key that never had data. The `refreshOn` events make it ask again, coalesced to one call per frame.
 */
export function useQuery<C extends ChannelName>(
  channel: C,
  payload?: ChannelReq<C>,
  refreshOn: EventType[] = [],
): Query<ChannelRes<C>> {
  const entry = entryFor(channel, payload);
  const events = refreshOn.join(",");

  const subscribe = useCallback(
    (listener: () => void) =>
      attach(entry, listener, events ? (events.split(",") as EventType[]) : []),
    [entry, events],
  );
  const read = useCallback(() => entry.snap, [entry]);
  return useSyncExternalStore(subscribe, read) as Query<ChannelRes<C>>;
}
