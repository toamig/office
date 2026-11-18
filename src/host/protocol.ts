import type { IpcEnvelope, OfficeEvent } from "../shared/ipc";

/** The name of the query parameter that carries the host's token, in the page URL and the socket URL. */
export const IPC_TOKEN_PARAM = "token";

/** Page to host. */
export type ClientMessage =
  | { t: "invoke"; id: number; channel: string; payload: unknown }
  | { t: "pty-write"; id: string; data: string }
  | { t: "pty-resize"; id: string; cols: number; rows: number }
  | { t: "control"; id: number; op: string; args: unknown };

/** Host to page. */
export type HostMessage =
  | { t: "result"; id: number; envelope: IpcEnvelope<unknown> }
  | { t: "event"; event: OfficeEvent }
  | { t: "pty"; id: string; data: string; end: number };
