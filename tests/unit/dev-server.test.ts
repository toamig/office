import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkPreviewUrl, detectDevServer, portOpen } from "../../src/main/core/dev-server";

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function listen(): Promise<number> {
  const server = http.createServer((_req, res) => res.end("ok"));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

describe("preview addresses", () => {
  it("accepts web addresses, adds http to a bare host, and refuses other schemes", () => {
    expect(checkPreviewUrl("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(checkPreviewUrl("localhost:3000/app")).toBe("http://localhost:3000/app");
    expect(checkPreviewUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(() => checkPreviewUrl("file:///C:/secret.txt")).toThrow(/Only http and https/);
    expect(() => checkPreviewUrl("javascript:alert(1)")).toThrow(/Only http and https/);
    expect(() => checkPreviewUrl("")).toThrow(/valid address/);
  });
});

describe("dev server detection", () => {
  it("finds an open port and reports a closed one", async () => {
    const port = await listen();
    expect(await portOpen(port)).toBe(true);
    servers.pop()?.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(await portOpen(port)).toBe(false);
  });

  it("returns the first listening port of the list as a localhost URL, or null", async () => {
    const port = await listen();
    expect(await detectDevServer([port + 1000 > 65000 ? 1 : port + 1000, port])).toBe(
      `http://localhost:${port}`,
    );
    expect(await detectDevServer([1])).toBeNull();
  });
});
