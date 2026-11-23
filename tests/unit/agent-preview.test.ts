import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { DevServers, guessPort, stopWithSession, suggestCommand } from "../../src/main/modules/chat/dev-servers";
import { OfficeTools } from "../../src/main/modules/chat/office-tools";
import type { OfficeEvent } from "../../src/shared/ipc";
import { tmp, write } from "../fixtures/repos/make";

let root: string;
beforeEach(() => { root = tmp("office-agent-preview-"); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** A "dev server": it opens a port, prints its address, and starts a child that writes a heartbeat. */
const SERVER = `
const { spawn } = require("node:child_process");
const net = require("node:net");
const [beat, port] = [process.argv[2], Number(process.argv[3])];
spawn(process.execPath, ["-e", "const fs=require('node:fs');setInterval(()=>fs.appendFileSync(process.argv[1],'x\\\\n'),40)", beat], { stdio: "ignore", windowsHide: true });
net.createServer().listen(port, "127.0.0.1", () => console.log("Local: http://localhost:" + port + "/"));
setInterval(() => {}, 1000);
`;

const beats = (file: string): number => { try { return readFileSync(file, "utf8").length; } catch { return 0; } };

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

describe("a dev server an agent started", () => {
  it("opens its page when the port answers, keeps its output, and stops with its children when the session ends", async () => {
    write(root, "server.cjs", SERVER);
    const heartbeat = join(root, "beat.txt");
    const port = await freePort();
    const bus = new Bus();
    const events: OfficeEvent[] = [];
    bus.on("*", (event) => events.push(event));
    const servers = new DevServers({ bus, cwdOf: () => root, pollMs: 50 });
    const archived = false;
    stopWithSession(bus, servers, () => archived);

    const started = servers.start("chat-1", { command: `node server.cjs ${heartbeat} ${port}`, port });
    expect(started.running).toBe(true);
    await vi.waitFor(() => expect(servers.state("chat-1").ready).toBe(true), { timeout: 15_000 });
    const preview = events.find((event) => event.type === "chat.preview");
    expect(preview?.payload).toEqual({ sessionId: "chat-1", url: `http://localhost:${port}` });
    expect(servers.state("chat-1").output.join("\n")).toContain(`http://localhost:${port}`);
    await vi.waitFor(() => expect(beats(heartbeat)).toBeGreaterThan(4));

    // The session ends: the server and its child both stop.
    bus.emit("session.status", { id: "chat-1", status: "exited" });
    expect(servers.state("chat-1").running).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settled = beats(heartbeat);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(beats(heartbeat)).toBe(settled);
    expect(archived).toBe(false);
  });

  it("stops when the session is archived or the owner presses Stop, and never for another session", async () => {
    write(root, "server.cjs", SERVER);
    const bus = new Bus();
    const servers = new DevServers({ bus, cwdOf: () => root, pollMs: 50 });
    let archived = new Set<string>();
    stopWithSession(bus, servers, (id) => archived.has(id));
    const first = join(root, "a.txt");
    const second = join(root, "b.txt");
    servers.start("a", { command: `node server.cjs ${first} ${await freePort()}` });
    servers.start("b", { command: `node server.cjs ${second} ${await freePort()}` });
    await vi.waitFor(() => expect(Math.min(beats(first), beats(second))).toBeGreaterThan(2), { timeout: 15_000 });
    archived = new Set(["a"]);
    bus.emit("session.status", { id: "a", status: "idle" });
    expect(servers.state("a").running).toBe(false);
    expect(servers.state("b").running).toBe(true);
    servers.stop("b");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settled = [beats(first), beats(second)];
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect([beats(first), beats(second)]).toEqual(settled);
  });

  it("only runs inside the session's folder", () => {
    mkdirSync(join(root, "app"), { recursive: true });
    const servers = new DevServers({ bus: new Bus(), cwdOf: () => join(root, "app") });
    expect(() => servers.start("a", { command: "node -e 1", folder: ".." })).toThrow(/inside the session/);
    expect(() => servers.start("a", { command: "node -e 1", folder: root })).toThrow(/inside the session/);
    expect(() => new DevServers({ bus: new Bus(), cwdOf: () => undefined }).start("a", { command: "x" })).toThrow(/no folder/);
  });

  it("suggests the project's dev or start script and the port its tool uses", () => {
    write(root, "package.json", JSON.stringify({ scripts: { dev: "vite --host", start: "node x" } }));
    expect(suggestCommand(root)).toEqual({ command: "npm run dev", port: 5173 });
    write(root, "other/package.json", JSON.stringify({ scripts: { start: "react-scripts start" } }));
    expect(suggestCommand(join(root, "other"))).toEqual({ command: "npm start", port: 3000 });
    expect(suggestCommand(join(root, "none"))).toBeNull();
    expect(guessPort("node server.js")).toBeNull();
  });
});

describe("Office tools that show a page beside the chat", () => {
  function fixture(autonomy: string) {
    const bus = { emit: vi.fn() };
    const start = vi.fn(() => ({ running: true }));
    const tool = new OfficeTools({
      bus, devServers: { start }, store: { state: { workspace: null } }, settings: () => ({ workspaceRoot: "ws" }),
      sessions: { find: () => ({ running: true, id: "chat", autonomy, incognito: false, cwd: root }) },
    } as unknown as ConstructorParameters<typeof OfficeTools>[0]);
    const abort = new AbortController();
    return { tool, bus, start, call: (name: string, args: unknown) => tool.request("chat", { kind: "call", name, arguments: args }, abort.signal) };
  }

  it("shows an address or a file of the session at once, with no card to answer", async () => {
    write(root, "docs/page.html", "<h1>Hi</h1>");
    const { tool, bus, call } = fixture("ask-first");
    expect(await call("office_preview_open", { address: "localhost:5173" })).toHaveProperty("message");
    expect(bus.emit).toHaveBeenCalledWith("chat.preview", { sessionId: "chat", url: "http://localhost:5173/" });
    expect(await call("office_preview_open", { file: "docs/page.html" })).toHaveProperty("message");
    expect(bus.emit).toHaveBeenCalledWith("chat.preview", { sessionId: "chat", path: join(root, "docs", "page.html") });
    expect(tool.list("chat")).toEqual([]);
  });

  it("refuses a file outside the session folder, a missing file, a bad scheme and an ambiguous request", async () => {
    const { bus, call } = fixture("full-auto");
    expect(await call("office_preview_open", { file: "../secret.html" })).toHaveProperty("error");
    expect(await call("office_preview_open", { file: "missing.html" })).toHaveProperty("error");
    expect(await call("office_preview_open", { address: "file:///c:/secret.html" })).toHaveProperty("error");
    expect(await call("office_preview_open", { address: "a.test", file: "b.html" })).toHaveProperty("error");
    expect(await call("office_preview_open", {})).toHaveProperty("error");
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("starts a server at once under Act and Full auto, and asks first under Ask first", async () => {
    for (const level of ["act-on-risk", "full-auto"]) {
      const { start, call, tool } = fixture(level);
      expect(await call("office_preview_start", { command: "npm run dev", port: 5173 })).toMatchObject({ running: true });
      expect(start).toHaveBeenCalledWith("chat", { command: "npm run dev", port: 5173, folder: undefined });
      expect(tool.list("chat")).toEqual([]);
    }
    const { start, call, tool } = fixture("ask-first");
    const result = call("office_preview_start", { command: "npm run dev", port: 5173 });
    const [card] = tool.list("chat");
    expect(card?.preview).toContainEqual({ label: "Command", text: "npm run dev" });
    expect(start).not.toHaveBeenCalled();
    await tool.answer("chat", card!.id, true);
    expect(await result).toMatchObject({ running: true });
    expect(start).toHaveBeenCalledTimes(1);
    const declined = call("office_preview_start", { command: "npm run dev" });
    await tool.answer("chat", tool.list("chat")[0]!.id, false);
    expect(await declined).toHaveProperty("error");
    expect(start).toHaveBeenCalledTimes(1);
  });
});
