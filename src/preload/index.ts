import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_EVENT,
  IPC_INVOKE,
  IPC_PTY_DATA,
  IPC_PTY_RESIZE,
  IPC_PTY_WRITE,
} from "../shared/ipc-names";
import type { IpcEnvelope, OfficeApi, OfficeEvent } from "../shared/ipc";

const api: OfficeApi = {
  async invoke(channel, ...payload) {
    const envelope = (await ipcRenderer.invoke(
      IPC_INVOKE,
      channel,
      payload[0],
    )) as IpcEnvelope<never>;
    if (!envelope.ok) throw new Error(envelope.error.message);
    return envelope.data;
  },
  on(type, cb) {
    const handler = (_e: unknown, event: OfficeEvent): void => {
      if (type === "*" || event.type === type) cb(event);
    };
    ipcRenderer.on(IPC_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT, handler);
  },
  pty: {
    onData(id, cb) {
      const handler = (_e: unknown, ptyId: string, data: string, end: number): void => {
        if (ptyId === id) cb(data, end);
      };
      ipcRenderer.on(IPC_PTY_DATA, handler);
      return () => ipcRenderer.removeListener(IPC_PTY_DATA, handler);
    },
    write: (id, data) => ipcRenderer.send(IPC_PTY_WRITE, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC_PTY_RESIZE, id, cols, rows),
  },
};

contextBridge.exposeInMainWorld("office", api);
