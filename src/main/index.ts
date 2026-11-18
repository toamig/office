import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
} from "electron";
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
import { isE2E, unseenWindowOptions, watchVisibility } from "./e2e";
import { badgePng } from "./core/badge";
import { applyChrome, startingChrome } from "./chrome";
import { buildContextMenu, type MenuAction } from "./core/context-menu";
import { classifyKey, nextZoom } from "./core/keys";
import { restoreBounds, toSaved } from "./core/window-state";
import { isAllowedNavigation, isAppRequest } from "./core/window-security";
import { TITLE_BAR_HEIGHT } from "../shared/theme";
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

/** Applies the interface zoom from the settings; pinch zoom is off so only Office's own zoom exists. */
function applyZoom(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed() || !ctx) return;
  void win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.setZoomFactor(ctx.settings().zoom / 100);
}

/** Runs one item of the native context menu against the page that was clicked. */
function runMenuAction(win: BrowserWindow, action: MenuAction, linkURL: string): void {
  const wc = win.webContents;
  if (typeof action === "object") return wc.replaceMisspelling(action.replaceWith);
  if (action === "undo") wc.undo();
  else if (action === "redo") wc.redo();
  else if (action === "cut") wc.cut();
  else if (action === "copy") wc.copy();
  else if (action === "paste") wc.paste();
  else if (action === "selectAll") wc.selectAll();
  else if (action === "copyLink") clipboard.writeText(linkURL);
  else if (action === "openLink" && isHttps(linkURL)) void shell.openExternal(linkURL);
}

/**
 * What takes the web page feel away (plan 12.1): no application menu and so none of its keys, the browser
 * keys that would reload, print or open developer tools turned off, the browser's zoom replaced by Office's
 * own, the mouse's back and forward buttons sent to the app's history, and a native right-click menu.
 */
function installNativeBehaviour(win: BrowserWindow): void {
  const development = !app.isPackaged;
  const wc = win.webContents;
  wc.on("before-input-event", (event, input) => {
    const action = classifyKey(input, development);
    if (action.kind === "devtools") {
      event.preventDefault();
      wc.toggleDevTools();
    }
    if (action.kind === "zoom" && ctx) {
      event.preventDefault();
      ctx.patchSettings({ zoom: nextZoom(ctx.settings().zoom, action.step) });
      ctx.bus.emit("settings.changed", {});
    }
  });
  wc.on("did-finish-load", () => applyZoom(win));
  win.on("app-command", (_event, command) => {
    if (command === "browser-backward") ctx?.bus.emit("app.history", "back");
    if (command === "browser-forward") ctx?.bus.emit("app.history", "forward");
  });
  wc.on("context-menu", (_event, params) => {
    const entries = buildContextMenu(params);
    if (entries.length === 0) return;
    const menu = Menu.buildFromTemplate(
      entries.map((entry) =>
        entry === "separator"
          ? { type: "separator" as const }
          : {
              label: entry.label,
              enabled: entry.enabled,
              click: () => runMenuAction(win, entry.action, params.linkURL),
            },
      ),
    );
    menu.popup({ window: win });
  });
}

function createWindow(): BrowserWindow {
  const settings = ctx?.settings();
  const chrome = startingChrome(settings?.theme ?? "system");
  const placed = restoreBounds(
    settings?.window,
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
  );
  const win = new BrowserWindow({
    ...placed.bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(isE2E() ? unseenWindowOptions() : {}),
    title: "Office",
    // No system title bar: the app draws its own top bar and the system draws only the window buttons.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: chrome.overlayColor,
      symbolColor: chrome.overlaySymbol,
      height: TITLE_BAR_HEIGHT,
    },
    backgroundColor: chrome.background,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A test run never has the window in front, and must not slow down because of it.
      ...(isE2E() ? { backgroundThrottling: false, offscreen: true } : {}),
    },
  });
  win.setMenuBarVisibility(false);
  installNativeBehaviour(win);
  if (placed.maximized) win.maximize();
  if (isE2E()) watchVisibility(win);
  else win.once("ready-to-show", () => win.show());

  // The window reopens where it was left, maximised or not.
  let saveTimer: NodeJS.Timeout | undefined;
  const remember = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen() || !ctx) return;
    ctx.patchSettings({ window: toSaved(win.getNormalBounds(), win.isMaximized()) });
  };
  const rememberSoon = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(remember, 400);
  };
  win.on("resize", rememberSoon);
  win.on("move", rememberSoon);
  win.on("maximize", rememberSoon);
  win.on("unmaximize", rememberSoon);
  win.on("close", () => {
    clearTimeout(saveTimer);
    remember();
  });

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
  if (!mainWindow || isE2E()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Desktop alert for an urgent notification; clicking it opens the place it links to. */
function showDesktopNotification(row: NotificationRow): void {
  if (isE2E() || !Notification.isSupported()) return;
  const note = new Notification({ title: row.title, body: row.body ?? "" });
  note.on("click", () => {
    focusWindow();
    if (row.link && ctx) ctx.bus.emit("app.navigate", row.link, row.projectId ?? undefined);
  });
  note.show();
}

function updateBadge(count: number): void {
  if (isE2E() || !mainWindow || mainWindow.isDestroyed()) return;
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
  // No application menu, so none of Electron's default accelerators (reload, developer tools, zoom) exist.
  // macOS keeps copy and paste in the Edit menu, so only there a menu with just that stays.
  Menu.setApplicationMenu(
    process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "editMenu" }]) : null,
  );
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
  // The window chrome follows the theme setting and the system's colour scheme at once.
  const refreshChrome = (): void => {
    applyChrome(mainWindow, context.settings().theme);
    applyZoom(mainWindow);
  };
  context.bus.on("settings.changed", refreshChrome);
  nativeTheme.on("updated", refreshChrome);
  context.notifier.addChannel({ id: "desktop", send: showDesktopNotification });
  context.notifier.onUnreadUrgentChange = updateBadge;
  mainWindow = createWindow();
  mainWindow.webContents.once("did-finish-load", () => context.notifier.reportUnread());
  app.on("browser-window-focus", () => void context.projects.refreshAll());
  await context.start();
  void updates.check();
}

// Hidden windows still get their frames and timers, so the page answers at full speed with nobody watching.
if (isE2E()) {
  for (const flag of [
    "disable-renderer-backgrounding",
    "disable-background-timer-throttling",
    "disable-backgrounding-occluded-windows",
  ]) {
    app.commandLine.appendSwitch(flag);
  }
}
// A run on its own data folder (tests, a trial) keeps Electron's own state there too. Otherwise it would share
// the installed app's folder, find that app's single-instance lock taken, quit, and wake the owner's window.
if (process.env["OFFICE_DATA"]) app.setPath("userData", join(process.env["OFFICE_DATA"], "electron"));
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
