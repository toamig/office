import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { IpcEnvelope, OfficeEvent } from "../shared/ipc";
import type { AppContext } from "../main/context";
import { IPC_TOKEN_PARAM } from "./protocol";
import type { ClientMessage, HostMessage } from "./protocol";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

export interface HostServer {
  port: number;
  /** Tells every connected page something happened. */
  event(event: OfficeEvent): void;
  pty(id: string, data: string, end: number): void;
  close(): Promise<void>;
}

export interface HostServerOptions {
  ctx: AppContext;
  token: string;
  /** The built web interface; served at `/`. */
  staticDir: string;
  port?: number;
  /** Test-only operations (change the host's environment, script its menus); null refuses them all. */
  control: ((op: string, args: unknown) => Promise<unknown> | unknown) | null;
}

/**
 * One localhost WebSocket in front of the real handlers, and the built web interface beside it. A page
 * connects with the token from its URL; each message is an IPC call, a pty write or resize, or a test control.
 */
export async function startHostServer(options: HostServerOptions): Promise<HostServer> {
  const { ctx, token, staticDir } = options;
  const root = resolve(staticDir);
  // The web build's page is web.html (the desktop build's is index.html); either one is the page.
  const page = existsSync(join(root, "web.html")) ? "web.html" : "index.html";
  const http: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === sep || path === "/" || path === "\\") path = `/${page}`;
    let file = join(root, path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      // Anything that is not a file is the page itself.
      file = join(root, page);
      if (!existsSync(file)) {
        res.writeHead(404).end("The web interface is not built. Run npm run build:web.");
        return;
      }
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });

  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || url.searchParams.get(IPC_TOKEN_PARAM) !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  const send = (ws: WebSocket, message: HostMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (message: HostMessage): void => {
    const text = JSON.stringify(message);
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(text);
  };

  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (message.t === "invoke") {
        void ctx.ipc
          .dispatch(message.channel, message.payload)
          .then((envelope) => send(ws, { t: "result", id: message.id, envelope }));
      } else if (message.t === "pty-write") {
        ctx.sessions.write(message.id, message.data);
      } else if (message.t === "pty-resize") {
        ctx.sessions.resize(message.id, message.cols, message.rows);
      } else if (message.t === "control") {
        const run = options.control;
        const reply = (envelope: IpcEnvelope<unknown>): void =>
          send(ws, { t: "result", id: message.id, envelope });
        if (!run) {
          reply({ ok: false, error: { code: "no-control", message: "Test controls are off" } });
          return;
        }
        void Promise.resolve(run(message.op, message.args)).then(
          (data) => reply({ ok: true, data }),
          (err: Error) => reply({ ok: false, error: { code: "control", message: err.message } }),
        );
      }
    });
  });

  await new Promise<void>((done) => http.listen(options.port ?? 0, "127.0.0.1", done));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    event: (event) => broadcast({ t: "event", event }),
    pty: (id, data, end) => broadcast({ t: "pty", id, data, end }),
    close: async () => {
      for (const ws of sockets) ws.terminate();
      wss.close();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}
