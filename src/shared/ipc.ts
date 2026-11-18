import { z } from "zod";
import {
  HealthView,
  Inventory,
  NotificationFilter,
  NotificationRow,
  ProjectNote,
  ProviderStatus,
  OpenItemsView,
  ProjectDetail,
  ProjectSummary,
  SearchItem,
  SyncReport,
  ToolStatus,
  WaitingEntry,
  WorkspaceView,
  WorkspaceInspection,
  WriteResult,
} from "./models";

/** Every event type the main process can publish on the bus (plan 4.5). */
export const eventTypes = [
  "workspace.changed",
  "project.status",
  "session.status",
  "session.output-idle",
  "run.progress",
  "run.done",
  "notification.new",
  "notification.read",
  "vault.changed",
  "task.changed",
  "app.navigate",
] as const;
export type EventType = (typeof eventTypes)[number];

export interface OfficeEvent {
  type: EventType;
  at: string;
  projectId?: string;
  payload: unknown;
}

/** The IPC contract. Nothing outside this map is callable from the renderer. */
export const channels = {
  "app.ping": {
    req: z.object({ text: z.string() }),
    res: z.object({ text: z.string(), at: z.string() }),
  },
  "workspace.get": { req: z.void(), res: WorkspaceView },
  "projects.list": { req: z.void(), res: z.array(ProjectSummary) },
  "projects.get": { req: z.object({ id: z.string() }), res: ProjectDetail },
  "git.syncAll": { req: z.void(), res: SyncReport },
  "vault.openItems": { req: z.object({ projectId: z.string() }), res: OpenItemsView },
  "vault.waiting": { req: z.void(), res: z.array(WaitingEntry) },
  "vault.tickWaiting": {
    req: z.object({ projectId: z.string(), raw: z.string() }),
    res: WriteResult,
  },
  "vault.addWaiting": {
    req: z.object({
      projectId: z.string(),
      text: z.string().min(1),
      source: z.string().optional(),
    }),
    res: WriteResult,
  },
  "vault.addNote": {
    req: z.object({ projectId: z.string(), text: z.string().min(1) }),
    res: WriteResult,
  },
  "git.syncProject": { req: z.object({ id: z.string() }), res: SyncReport },
  "projects.openEditor": { req: z.object({ id: z.string() }), res: z.void() },
  "projects.openFolder": { req: z.object({ id: z.string() }), res: z.void() },
  "notes.read": { req: z.object({ projectId: z.string(), name: z.string() }), res: ProjectNote },
  "search.items": { req: z.void(), res: z.array(SearchItem) },
  "setup.detectTools": { req: z.void(), res: z.array(ToolStatus) },
  "setup.inspect": { req: z.object({ root: z.string() }), res: WorkspaceInspection },
  "setup.clone": {
    req: z.object({ url: z.string(), dest: z.string() }),
    res: z.object({ path: z.string(), hubCloned: z.boolean() }),
  },
  "setup.apply": {
    req: z.object({
      workspaceRoot: z.string(),
      workspaceConfigPath: z.string(),
      projectsRoot: z.string(),
      createIfMissing: z.boolean(),
    }),
    res: WorkspaceView,
  },
  "setup.inventory": {
    req: z.object({ projectId: z.string().optional() }),
    res: z.array(Inventory),
  },
  "setup.pickFolder": {
    req: z.object({ title: z.string().optional() }),
    res: z.string().nullable(),
  },
  "providers.list": { req: z.void(), res: z.array(ProviderStatus) },
  "notifications.list": { req: NotificationFilter, res: z.array(NotificationRow) },
  "notifications.markRead": {
    req: z.object({ ids: z.array(z.string()).optional() }),
    res: z.void(),
  },
  "notifications.counts": {
    req: z.void(),
    res: z.object({ unread: z.number(), urgentUnread: z.number() }),
  },
  "vault.health": { req: z.void(), res: HealthView },
  "projects.refresh": { req: z.object({ id: z.string().optional() }), res: z.void() },
} as const;

export type ChannelName = keyof typeof channels;
export type ChannelReq<C extends ChannelName> = z.infer<(typeof channels)[C]["req"]>;
export type ChannelRes<C extends ChannelName> = z.infer<(typeof channels)[C]["res"]>;

/** Errors cross IPC as this shape, never as raw stacks. */
export interface IpcError {
  code: string;
  message: string;
}
export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export { IPC_EVENT, IPC_INVOKE, IPC_PTY_DATA, IPC_PTY_RESIZE, IPC_PTY_WRITE } from "./ipc-names";

/** The whole surface preload exposes as window.office. */
export interface OfficeApi {
  invoke<C extends ChannelName>(
    channel: C,
    ...payload: ChannelReq<C> extends void ? [] : [ChannelReq<C>]
  ): Promise<ChannelRes<C>>;
  on(type: EventType | "*", cb: (event: OfficeEvent) => void): () => void;
  pty: {
    onData(id: string, cb: (data: string) => void): () => void;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
  };
}
