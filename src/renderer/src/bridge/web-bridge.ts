import type { ChannelName, OfficeApi, OfficeEvent } from "@shared/ipc";
import type { ClientMessage, HostMessage } from "../../../host/protocol";

/**
 * The web build's window.office (plan 12.4): the same interface the preload gives the desktop app, spoken to the
 * test host over one WebSocket. It is installed before the app mounts. Never part of the desktop build.
 */
export async function installWebBridge(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const token = params.get("token") ?? "";
  const base = params.get("host") ?? `ws://${location.host}`;
  const socket = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not reach the test host")), {
      once: true,
    });
  });

  let next = 1;
  const pending = new Map<number, (envelope: HostMessage & { t: "result" }) => void>();
  const listeners = new Set<{ type: string; cb: (event: OfficeEvent) => void }>();
  const ptyListeners = new Map<string, Set<(data: string, end: number) => void>>();
  const send = (message: ClientMessage): void => socket.send(JSON.stringify(message));

  socket.addEventListener("message", (e) => {
    const message = JSON.parse(String(e.data)) as HostMessage;
    if (message.t === "result") {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } else if (message.t === "event") {
      for (const l of listeners)
        if (l.type === "*" || l.type === message.event.type) l.cb(message.event);
    } else {
      ptyListeners.get(message.id)?.forEach((cb) => cb(message.data, message.end));
    }
  });
  socket.addEventListener("close", () => {
    for (const reply of pending.values())
      reply({
        t: "result",
        id: 0,
        envelope: { ok: false, error: { code: "closed", message: "The test host closed" } },
      });
    pending.clear();
  });

  type Call =
    | { t: "invoke"; channel: string; payload: unknown }
    | { t: "control"; op: string; args: unknown };
  const call = (message: Call): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, (reply) =>
        reply.envelope.ok
          ? resolve(reply.envelope.data)
          : reject(new Error(reply.envelope.error.message)),
      );
      send({ ...message, id } as ClientMessage);
    });

  const api: OfficeApi = {
    invoke: ((channel: ChannelName, payload?: unknown) =>
      call({ t: "invoke", channel, payload })) as OfficeApi["invoke"],
    on(type, cb) {
      const entry = { type, cb };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    pty: {
      onData(id, cb) {
        let set = ptyListeners.get(id);
        if (!set) ptyListeners.set(id, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
      },
      write: (id, data) => send({ t: "pty-write", id, data }),
      resize: (id, cols, rows) => send({ t: "pty-resize", id, cols, rows }),
    },
  };
  window.office = api;
  // The host's test controls (change its environment, script its menus) are reachable from the page for tests.
  (
    window as unknown as { __hostControl?: (op: string, args?: unknown) => Promise<unknown> }
  ).__hostControl = (op, args) => call({ t: "control", op, args });
}
