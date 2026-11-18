import { app, BrowserWindow, ipcMain, Notification, nativeImage, shell } from "electron";
import { join } from "node:path";
import type { NotificationRow } from "../shared/models";
import {
  IPC_EVENT,
  IPC_INVOKE,
  IPC_PTY_DATA,
  IPC_PTY_RESIZE,
  IPC_PTY_WRITE,
} from "../shared/ipc-names";
import { createContext, type AppContext } from "./context";
import { badgePng } from "./core/badge";
import { isAllowedNavigation, isAppRequest } from "./core/window-security";
import { registerHandlers } from "./handlers";
import { PreviewPane } from "./preview";
import { autoUpdater } from "electron-updater";
import { UpdateService, type UpdaterLike } from "./core/update";
import { registerShellHandlers } from "./shell-handlers";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'";

let mainWindow: BrowserWindow | null = null;
let ctx: AppContext | null = null;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Office",
    backgroundColor: "#1b1d20",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());

  // Packaged builds get the strict CSP as a header too (the page also carries it as a meta tag).
  if (!process.env["ELECTRON_RENDERER_URL"]) {
    const appId = win.webContents.id;
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      // The preview pane shares this session; a previewed site keeps its own policy.
      if (!isAppRequest(details.webContentsId, appId)) return callback({});
      callback({
        responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] },
      });
    });
  }
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, process.env["ELECTRON_RENDERER_URL"])) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttps(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Desktop alert for an urgent notification; clicking it opens the place it links to. */
function showDesktopNotification(row: NotificationRow): void {
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: row.title, body: row.body ?? "" });
  note.on("click", () => {
    focusWindow();
    if (row.link && ctx) ctx.bus.emit("app.navigate", row.link, row.projectId ?? undefined);
  });
  note.show();
}

function updateBadge(count: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform === "win32") {
    mainWindow.setOverlayIcon(
      count > 0 ? nativeImage.createFromBuffer(badgePng(count)) : null,
      count > 0 ? `${count} unread urgent` : "",
    );
  } else {
    app.setBadgeCount(count);
  }
}

async function boot(): Promise<void> {
  app.setAppUserModelId("com.toamig.office");
  const relayScript =
    process.env["OFFICE_RELAY_SCRIPT"] ??
    (app.isPackaged
      ? join(process.resourcesPath, "relay", "office-relay.mjs")
      : join(app.getAppPath(), "resources", "relay", "office-relay.mjs"));
  const context = await createContext(!app.isPackaged, relayScript);
  ctx = context;
  registerHandlers(context);
  const preview = new PreviewPane(
    () => mainWindow,
    (state) => context.bus.emit("preview.state", state),
  );
  const updates = new UpdateService({
    updater: autoUpdater as unknown as UpdaterLike,
    version: app.getVersion(),
    enabled: app.isPackaged && !process.env["OFFICE_DATA"] && !process.env["OFFICE_NO_UPDATE"],
    disabledReason: app.isPackaged
      ? "Updates are off while the app runs against test data"
      : "Updates are off in development runs",
    onChange: (status) => context.bus.emit("app.update", status),
  });
  registerShellHandlers(context, preview, updates);
  ipcMain.handle(IPC_INVOKE, (_event, channel: unknown, payload: unknown) =>
    context.ipc.dispatch(channel, payload),
  );
  context.bus.on("*", (event) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC_EVENT, event);
  });
  context.sessions.sink = (id, data, end) => {
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send(IPC_PTY_DATA, id, data, end);
  };
  ipcMain.on(IPC_PTY_WRITE, (_e, id: unknown, data: unknown) => {
    if (typeof id === "string" && typeof data === "string") context.sessions.write(id, data);
  });
  ipcMain.on(IPC_PTY_RESIZE, (_e, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id === "string" && typeof cols === "number" && typeof rows === "number") {
      context.sessions.resize(id, cols, rows);
    }
  });
  context.notifier.addChannel({ id: "desktop", send: showDesktopNotification });
  context.notifier.onUnreadUrgentChange = updateBadge;
  mainWindow = createWindow();
  mainWindow.webContents.once("did-finish-load", () => context.notifier.reportUnread());
  app.on("browser-window-focus", () => void context.projects.refreshAll());
  await context.start();
  void updates.check();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", focusWindow);
  void app.whenReady().then(boot);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    ctx?.sessions.shutdown();
    void ctx?.stop();
  });
}
