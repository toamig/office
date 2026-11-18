import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'";

let mainWindow: BrowserWindow | null = null;

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

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] },
    });
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://") && !url.startsWith("http://localhost")) event.preventDefault();
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void app.whenReady().then(() => {
    app.setAppUserModelId("com.toamig.office");
    mainWindow = createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
