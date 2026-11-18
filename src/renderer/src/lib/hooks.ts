import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelName, ChannelReq, ChannelRes, EventType } from "@shared/ipc";
import { office } from "./ipc";

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Calls an IPC channel, and calls it again when one of the `refreshOn` events arrives. */
export function useQuery<C extends ChannelName>(
  channel: C,
  payload?: ChannelReq<C>,
  refreshOn: EventType[] = [],
): Query<ChannelRes<C>> {
  const [data, setData] = useState<ChannelRes<C>>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(payload ?? null);
  const alive = useRef(true);

  const load = useCallback(() => {
    const call = office.invoke as (c: ChannelName, p?: unknown) => Promise<ChannelRes<C>>;
    call(channel, payload).then(
      (result) => {
        if (!alive.current) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (err: Error) => {
        if (!alive.current) return;
        setError(err.message);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, key]);

  useEffect(() => {
    alive.current = true;
    load();
    const offs = refreshOn.map((type) => office.on(type, () => load()));
    return () => {
      alive.current = false;
      offs.forEach((off) => off());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshOn.join(",")]);

  return { data, error, loading, reload: load };
}

/** "3 minutes ago" style text, kept short for dense lists. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
