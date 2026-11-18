import {
  channels,
  type ChannelName,
  type ChannelReq,
  type ChannelRes,
  type IpcEnvelope,
} from "../../shared/ipc";

type Handler<C extends ChannelName> = (
  req: ChannelReq<C>,
) => Promise<ChannelRes<C>> | ChannelRes<C>;
type HandlerMap = { [C in ChannelName]?: Handler<C> };

/** Throw this from a handler to send a stable code and a message the UI may show. */
export class IpcFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: string, message: string): IpcEnvelope<never> => ({
  ok: false,
  error: { code, message },
});

/** The handler registry. Validates every request, and every response when `checkResponses` is on. */
export class IpcRegistry {
  private readonly handlers: HandlerMap = {};

  constructor(private readonly checkResponses = false) {}

  handle<C extends ChannelName>(channel: C, handler: Handler<C>): void {
    (this.handlers as Record<string, unknown>)[channel] = handler;
  }

  async dispatch(channel: unknown, payload: unknown): Promise<IpcEnvelope<unknown>> {
    if (typeof channel !== "string" || !(channel in channels)) {
      return fail("unknown-channel", `Unknown channel: ${String(channel)}`);
    }
    const name = channel as ChannelName;
    const spec = channels[name];
    const handler = this.handlers[name] as Handler<ChannelName> | undefined;
    if (!handler) return fail("no-handler", `No handler for ${name}`);
    const req = spec.req.safeParse(payload);
    if (!req.success)
      return fail("bad-request", `Invalid request for ${name}: ${req.error.message}`);
    try {
      const data = await handler(req.data as never);
      if (this.checkResponses) {
        const res = spec.res.safeParse(data);
        if (!res.success)
          return fail("bad-response", `Invalid response from ${name}: ${res.error.message}`);
      }
      return { ok: true, data };
    } catch (err) {
      if (err instanceof IpcFailure) return fail(err.code, err.message);
      console.error(`ipc ${name} failed:`, err);
      return fail("internal", (err as Error).message || "Something went wrong");
    }
  }
}
