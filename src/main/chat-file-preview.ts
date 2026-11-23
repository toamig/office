import { BrowserWindow, session, shell, WebContentsView } from "electron";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { Readable } from "node:stream";
import { imageMime, insideFolder, isHtmlFile, isPdfFile, scopedFile, type FileScope } from "./modules/chat/files";
import type { PreviewBounds } from "../shared/models";

const resourceTypes: Record<string, string> = {
  ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain", ".wasm": "application/wasm",
  ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".webm": "video/webm",
};
const loopback = ["localhost", "127.0.0.1", "[::1]"];
const loopbackOrigins = loopback.flatMap((host) => [`http://${host}:*`, `https://${host}:*`, `ws://${host}:*`, `wss://${host}:*`]).join(" ");
const pagePolicy = `default-src 'self' ${loopbackOrigins}; script-src 'self' 'unsafe-inline' ${loopbackOrigins}; style-src 'self' 'unsafe-inline' ${loopbackOrigins}; object-src 'none'; frame-ancestors 'none'; worker-src 'none'; base-uri 'self'; form-action 'self' ${loopbackOrigins}`;
const pdfExtension = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

function allowedRequest(raw: string, pdf: boolean): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === "office-preview:" && url.hostname === "local") return true;
    if (pdf && raw.startsWith(pdfExtension)) return true;
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || !loopback.includes(url.hostname) || url.username || url.password) return false;
    const development = process.env["ELECTRON_RENDERER_URL"];
    return !development || url.port !== new URL(development).port;
  } catch { return false; }
}

function outsideBrowser(raw: string): void {
  try {
    const url = new URL(raw);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) void shell.openExternal(url.href);
  } catch { /* Invalid URLs stay closed. */ }
}

async function localResponse(request: Request, folder: string, scope: FileScope): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.hostname !== "local" || !["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 403 });
    const path = decodeURIComponent(url.pathname.slice(1));
    const local = await scopedFile({ cwd: folder, roots: [folder], private: scope.private }, path);
    if (!insideFolder(folder, local)) return new Response(null, { status: 403 });
    const authorized = await scopedFile(scope, local);
    const mime = isHtmlFile(authorized) ? "text/html; charset=utf-8" : isPdfFile(authorized) ? "application/pdf"
      : imageMime(authorized) ?? resourceTypes[extname(authorized).toLowerCase()] ?? "application/octet-stream";
    const stream = request.method === "HEAD" ? null : Readable.toWeb(createReadStream(authorized)) as unknown as ReadableStream;
    return new Response(stream, { headers: {
      "Content-Type": mime, "Content-Length": String((await stat(authorized)).size),
      "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
      ...(isPdfFile(authorized) ? {} : { "Content-Security-Policy": pagePolicy }),
    } });
  } catch { return new Response(null, { status: 404 }); }
}

interface NativeFile { window: BrowserWindow; view: WebContentsView }

/** File previews run outside Office's renderer and its default browser session. */
export class ChatFilePreview {
  private readonly views = new Map<string, NativeFile>();
  private readonly bounds = new Map<string, PreviewBounds>();

  constructor(private readonly window: () => BrowserWindow | undefined, private readonly scope: (id: string) => FileScope) {}

  async open(id: string, file: string): Promise<void> {
    const win = this.window();
    if (!win) throw new Error("There is no window for the file preview.");
    this.close(id, false);
    const pdf = isPdfFile(file);
    const isolated = session.fromPartition(`office-file-preview-${randomUUID()}`, { cache: false });
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.on("will-download", (event) => event.preventDefault());
    isolated.protocol.handle("office-preview", (request) => {
      try { return localResponse(request, dirname(file), this.scope(id)); }
      catch { return new Response(null, { status: 403 }); }
    });
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedRequest(details.url, pdf) }));
    isolated.webRequest.onHeadersReceived((details, callback) => {
      if (!/^https?:/i.test(details.url) || !["mainFrame", "subFrame"].includes(details.resourceType)) return callback({});
      const headers = Object.fromEntries(Object.entries(details.responseHeaders ?? {}).filter(([name]) => name.toLowerCase() !== "content-security-policy"));
      callback({ responseHeaders: { ...headers, "Content-Security-Policy": [pagePolicy] } });
    });
    const view = new WebContentsView({ webPreferences: {
      session: isolated, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, plugins: pdf,
    } });
    const wc = view.webContents;
    const guard = (event: Electron.Event, raw: string, external: boolean) => {
      if (allowedRequest(raw, pdf)) return;
      event.preventDefault();
      if (external) outsideBrowser(raw);
    };
    wc.on("will-frame-navigate", (event) => guard(event, event.url, event.isMainFrame));
    wc.on("will-redirect", (event) => guard(event, event.url, event.isMainFrame));
    wc.setWindowOpenHandler(({ url }) => {
      if (allowedRequest(url, pdf)) void wc.loadURL(url).catch(() => undefined);
      else outsideBrowser(url);
      return { action: "deny" };
    });
    wc.once("destroyed", () => { isolated.protocol.unhandle("office-preview"); });
    view.setVisible(false);
    win.contentView.addChildView(view);
    this.views.set(id, { window: win, view });
    this.apply(id);
    try { await wc.loadURL(`office-preview://local/${encodeURIComponent(basename(file))}`); }
    catch (error) {
      if (this.views.get(id)?.view !== view) return;
      this.close(id, false);
      throw error;
    }
  }

  setBounds(id: string, bounds: PreviewBounds): void {
    this.bounds.set(id, bounds);
    this.apply(id);
  }

  private apply(id: string): void {
    const view = this.views.get(id)?.view;
    const bounds = this.bounds.get(id);
    if (!view || !bounds) return;
    const { x, y, width, height, visible } = bounds;
    view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)) });
    view.setVisible(visible && width > 0 && height > 0);
  }

  close(id: string, forgetBounds = true): void {
    if (forgetBounds) this.bounds.delete(id);
    const owned = this.views.get(id);
    if (!owned) return;
    this.views.delete(id);
    if (!owned.window.isDestroyed()) owned.window.contentView.removeChildView(owned.view);
    if (!owned.view.webContents.isDestroyed()) owned.view.webContents.close();
  }
}
