import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../..");

/** What only the test host and the web bridge contain. */
const MARKERS = [
  "OFFICE_HOST_READY",
  "installWebBridge",
  "__hostControl",
  "WebSocketServer",
  "gallery-open-dialog",
  "VITE_GALLERY",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The names of the files inside an asar archive, read from its header. */
function asarEntries(archive: string): string[] {
  const fd = openSync(archive, "r");
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, 16, 0);
    const size = prefix.readUInt32LE(12);
    const header = Buffer.alloc(size);
    readSync(fd, header, 0, size, 16);
    const names: string[] = [];
    const walk = (node: { files?: Record<string, unknown> }, base: string): void => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        names.push(`${base}${name}`);
        walk(child as { files?: Record<string, unknown> }, `${base}${name}/`);
      }
    };
    walk(JSON.parse(header.toString("utf8")) as { files?: Record<string, unknown> }, "");
    return names;
  } finally {
    closeSync(fd);
  }
}

describe("the test host and the web bridge are never shipped", () => {
  it("the installer packs only the desktop build", () => {
    const config = parse(readFileSync(join(ROOT, "electron-builder.yml"), "utf8")) as {
      files: string[];
    };
    expect(config.files).toEqual(["out/**", "package.json"]);
  });

  it("the desktop build output holds neither the host nor the bridge", () => {
    const out = join(ROOT, "out");
    if (!existsSync(out)) return;
    const found: string[] = [];
    for (const file of files(out)) {
      if (!/\.(js|html|css)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const marker of MARKERS) if (text.includes(marker)) found.push(`${file}: ${marker}`);
    }
    expect(found).toEqual([]);
    expect(existsSync(join(out, "host"))).toBe(false);
    expect(existsSync(join(out, "web"))).toBe(false);
  });

  it("the packaged app has neither", () => {
    const archive = join(ROOT, "release", "win-unpacked", "resources", "app.asar");
    if (!existsSync(archive)) return;
    const entries = asarEntries(archive);
    expect(entries.length).toBeGreaterThan(10);
    expect(
      entries.filter(
        (e) => /(^|\/)(host|out-web|web-bridge)/.test(e) || e.startsWith("node_modules/ws"),
      ),
    ).toEqual([]);
    const text = readFileSync(archive).toString("latin1");
    for (const marker of MARKERS) expect(text.includes(marker), marker).toBe(false);
  });
});
