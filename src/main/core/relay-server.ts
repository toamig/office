import { timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { relayInfoPath } from "./paths";
import { writeTextFile } from "./settings";

export interface RelayHandlers {
  onClaude: (payload: Record<string, unknown>) => boolean;
  onCodex: (payload: Record<string, unknown>) => boolean;
  /**
   * A headless run asks whether it may use a tool. The answer can take hours, so the response is held
   * until it resolves; `signal` aborts when the asking process goes away.
   */
  onPermission?: (
    runId: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>;
}

const PERMISSION_ROUTE = /^\/permission\/([A-Za-z0-9-]{1,80})$/;
const OFFICE_TOOLS_ROUTE = /^\/office-tools\/([A-Za-z0-9-]{1,80})$/;

const MAX_BODY = 1024 * 1024;

function tokenOk(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A local-only HTTP endpoint that the hook relay posts to. Bound to 127.0.0.1 and token protected. */
export class RelayServer {
  private server: http.Server | null = null;
  port = 0;
  officeTools?: {
    authorized: (id: string, authorization: string | undefined) => boolean;
    request: (id: string, body: Record<string, unknown>, signal: AbortSignal) => Promise<Record<string, unknown>>;
  };

  constructor(
    private readonly token: string,
    private readonly handlers: RelayHandlers,
  ) {}

  /** Listens on the wanted port; if it is taken, on a free one. Writes relay.json for the relay script. */
  async start(wantedPort: number): Promise<number> {
    await this.stop();
    const server = http.createServer((req, res) => this.handle(req, res));
    const listen = (port: number): Promise<void> =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
    try {
      await listen(wantedPort);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      await listen(0);
    }
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    const file = relayInfoPath();
    writeTextFile(file, `${JSON.stringify({ port: this.port, token: this.token })}\n`);
    try {
      chmodSync(file, 0o600);
    } catch {
      /* permissions are best effort on Windows */
    }
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** Keeps the response open until the owner answers; a dropped connection cancels the question. */
  private hold(
    res: http.ServerResponse,
    request: (signal: AbortSignal) => Promise<Record<string, unknown>>,
  ): void {
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    void request(abort.signal)
      .then((answer) => {
        if (res.writableEnded || res.destroyed) return;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(answer));
      })
      .catch((err) => {
        console.error("relay request failed:", err);
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end();
        }
      });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const end = (code: number): void => {
      res.statusCode = code;
      res.end();
    };
    if (req.method !== "POST") return end(405);
    const conversation = OFFICE_TOOLS_ROUTE.exec(req.url ?? "")?.[1];
    if (conversation) {
      if (!this.officeTools?.authorized(conversation, req.headers.authorization)) return end(401);
    } else if (!tokenOk(req.headers.authorization, this.token)) return end(401);
    const permission = PERMISSION_ROUTE.exec(req.url ?? "");
    const route =
      req.url === "/hook/claude"
        ? "claude"
        : req.url === "/hook/codex"
          ? "codex"
          : permission
            ? "permission"
            : null;
    if (!route && !conversation) return end(404);
    if (route === "permission" && !this.handlers.onPermission) return end(404);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        end(413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return end(400);
      }
      if (!payload || typeof payload !== "object") return end(400);
      const body = payload as Record<string, unknown>;
      if (conversation && this.officeTools) {
        if (!this.officeTools.authorized(conversation, req.headers.authorization)) return end(401);
        this.hold(res, (signal) => this.officeTools!.request(conversation, body, signal));
        return;
      }
      if (route === "permission") {
        this.hold(res, (signal) => this.handlers.onPermission!(permission?.[1] ?? "", body, signal));
        return;
      }
      try {
        const matched =
          route === "claude" ? this.handlers.onClaude(body) : this.handlers.onCodex(body);
        end(matched ? 200 : 204);
      } catch (err) {
        console.error("relay handler failed:", err);
        end(500);
      }
    });
  }
}
