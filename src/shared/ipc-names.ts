/** IPC channel names. Kept apart from ipc.ts so the sandboxed preload does not bundle zod. */
export const IPC_INVOKE = "office:invoke";
export const IPC_EVENT = "office:event";
export const IPC_PTY_DATA = "office:pty:data";
export const IPC_PTY_WRITE = "office:pty:write";
export const IPC_PTY_RESIZE = "office:pty:resize";
