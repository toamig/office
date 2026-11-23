import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { build } from "vite";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../support/prepare";

/**
 * An HTML file the agent wrote is shown in the chat's side panel. The page is untrusted: whatever its scripts do,
 * it must not reach Office's bridge, Node, a folder other than its own, or a remote origin. The test runs the real
 * ChatFilePreview in a hidden window of a bare Electron main, so nothing appears on the owner's desktop.
 */
let app: ElectronApplication | undefined;
let work = "";
let server: Server | undefined;
const hits: string[] = [];

const lanAddress = (): string | undefined =>
  Object.values(networkInterfaces()).flat().find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;

test.afterEach(async () => {
  await app?.close().catch(() => undefined);
  server?.close();
  app = undefined;
  server = undefined;
  if (work) rmSync(work, { recursive: true, force: true });
});

test("an HTML file in the panel cannot reach the bridge, Node, another folder or a remote origin", async () => {
  const lan = lanAddress();
  test.skip(!lan, "This machine has no non-loopback address to stand in for a remote origin.");
  work = mkdtempSync(join(tmpdir(), "office-preview-test-"));
  const site = join(work, "site");
  mkdirSync(join(site, "assets"), { recursive: true });
  mkdirSync(join(work, "other"), { recursive: true });
  writeFileSync(join(work, "secret.txt"), "parent secret");
  writeFileSync(join(work, "other", "secret.txt"), "other folder secret");
  writeFileSync(join(site, "assets", "data.json"), '{"own":true}');

  server = createServer((req, res) => {
    hits.push(`${req.socket.remoteAddress}${req.url}`);
    res.setHeader("access-control-allow-origin", "*");
    res.end("hit");
  });
  await new Promise<void>((resolve) => server!.listen(0, "0.0.0.0", resolve));
  const port = (server.address() as { port: number }).port;

  const probe = `
    const result = {};
    result.office = typeof window.office; result.electron = typeof window.electron;
    result.require = typeof require; result.process = typeof process; result.module = typeof module;
    result.bridgeKeys = Object.keys(window).filter((key) => /office|electron|ipc|bridge/i.test(key));
    result.opener = window.opener === null; result.topIsSelf = window.top === window;
    const attempt = async (name, request) => {
      try { const response = await request(); result[name] = response.ok ? "reached" : "status " + response.status; }
      catch { result[name] = "blocked"; }
    };
    (async () => {
      await attempt("ownFolder", () => fetch("office-preview://local/assets/data.json"));
      await attempt("parentFolder", () => fetch("office-preview://local/..%2Fsecret.txt"));
      await attempt("parentFolderDots", () => fetch("office-preview://local/%2e%2e/secret.txt"));
      await attempt("otherFolder", () => fetch("office-preview://local/..%2Fother%2Fsecret.txt"));
      await attempt("fileUrl", () => fetch(${JSON.stringify(`file:///${work.replace(/\\/g, "/")}/secret.txt`)}));
      await attempt("remoteFetch", () => fetch("http://${lan}:${port}/fetch"));
      await new Promise((resolve) => {
        const image = new Image();
        image.onload = image.onerror = () => resolve(undefined);
        image.src = "http://${lan}:${port}/image";
      });
      await attempt("remoteWebSocket", () => new Promise((resolve, reject) => {
        const socket = new WebSocket("ws://${lan}:${port}/socket");
        socket.onopen = () => resolve({ ok: true }); socket.onerror = () => reject(new Error("blocked"));
      }));
      window.__probe = result;
    })();`;
  writeFileSync(join(site, "index.html"), `<!doctype html><title>probe</title><script>${probe}</script>`);

  const main = join(work, "main.cjs");
  const entry = join(work, "entry.ts");
  writeFileSync(entry, `
    import { app, BrowserWindow, protocol } from "electron";
    import { ChatFilePreview } from ${JSON.stringify(join(repoRoot, "src/main/chat-file-preview.ts").replace(/\\/g, "/"))};
    protocol.registerSchemesAsPrivileged([
      { scheme: "office-preview", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
    ]);
    app.on("window-all-closed", () => undefined);
    app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 900, height: 700 });
      const root = ${JSON.stringify(site)};
      const preview = new ChatFilePreview(() => win, () => ({ cwd: root, roots: [root], private: [] }));
      Object.assign(globalThis, { win, preview });
    });`);
  await build({
    configFile: false, logLevel: "silent", root: repoRoot,
    ssr: { noExternal: true, external: ["electron"] },
    build: {
      ssr: entry, outDir: work, emptyOutDir: false, minify: false, target: "node22",
      rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: "main.cjs" } },
    },
  });

  app = await electron.launch({ args: [main], env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } as Record<string, string> });
  await expect.poll(() => app!.evaluate(() => "preview" in globalThis)).toBe(true);
  await app.evaluate(async (_electron, file) => {
    const g = globalThis as unknown as { preview: { open(id: string, file: string): Promise<void>; setBounds(id: string, b: object): void } };
    g.preview.setBounds("chat", { x: 0, y: 0, width: 800, height: 600, visible: true });
    await g.preview.open("chat", file);
  }, join(site, "index.html"));

  const read = () => app!.evaluate(async () => {
    const g = globalThis as unknown as { preview: { views: Map<string, { view: { webContents: { executeJavaScript(code: string): Promise<unknown> } } }> } };
    return g.preview.views.get("chat")!.view.webContents.executeJavaScript("window.__probe ?? null");
  });
  await expect.poll(read, { timeout: 20000 }).not.toBeNull();
  const result = (await read()) as Record<string, unknown>;

  // The page runs, and reads its own folder.
  expect(result["ownFolder"]).toBe("reached");
  // No Office bridge and no Node.
  expect(result["office"]).toBe("undefined");
  expect(result["electron"]).toBe("undefined");
  expect(result["require"]).toBe("undefined");
  expect(result["process"]).toBe("undefined");
  expect(result["module"]).toBe("undefined");
  expect(result["bridgeKeys"]).toEqual([]);
  expect(result["opener"]).toBe(true);
  expect(result["topIsSelf"]).toBe(true);
  // No other folder, and no file URL.
  for (const name of ["parentFolder", "parentFolderDots", "otherFolder"]) expect(result[name], name).not.toBe("reached");
  expect(result["fileUrl"]).toBe("blocked");
  // No remote origin: not by fetch, image or WebSocket, and the server never saw a request.
  expect(result["remoteFetch"]).toBe("blocked");
  expect(result["remoteWebSocket"]).toBe("blocked");
  expect(hits).toEqual([]);
  // The window that held the preview never appeared.
  expect(await app.evaluate(() => (globalThis as unknown as { win: { isVisible(): boolean } }).win.isVisible())).toBe(false);
});
