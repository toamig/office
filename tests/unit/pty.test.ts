import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTool } from "../../src/main/core/exec";
import { PtyManager } from "../../src/main/modules/sessions/pty-manager";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "office-pty-"));
  const chunks: Record<string, string> = {};
  const exits: Record<string, number> = {};
  const manager = new PtyManager(join(dir, "sessions"), {
    onData: (id, data) => (chunks[id] = (chunks[id] ?? "") + data),
    onExit: (id, code) => (exits[id] = code),
  });
  return { dir, manager, chunks, exits };
}

async function until(cond: () => boolean, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
}

const node = resolveTool("node") as string;

describe("PtyManager", () => {
  it("runs a program, echoes typed input, reports exit and keeps a log", async () => {
    const { dir, manager, chunks, exits } = setup();
    manager.spawn(
      "echo1",
      {
        cmd: node,
        args: [
          "-e",
          "process.stdin.on('data', d => { console.log('GOT:' + d.toString().trim()); if (/quit/.test(d)) process.exit(7); }); console.log('READY')",
        ],
      },
      { cwd: dir },
    );
    await until(() => (chunks["echo1"] ?? "").includes("READY"));
    manager.write("echo1", "hello\r");
    await until(() => (chunks["echo1"] ?? "").includes("GOT:hello"));
    manager.write("echo1", "quit\r");
    await until(() => exits["echo1"] !== undefined);
    expect(exits["echo1"]).toBe(7);
    const { data, upTo } = manager.history("echo1");
    expect(data).toContain("GOT:hello");
    expect(upTo).toBe(data.length);
    expect(readFileSync(join(dir, "sessions", "echo1.log"), "utf8")).toContain("GOT:hello");
    expect(manager.isRunning("echo1")).toBe(false);
  });

  it("resizes and kills a running terminal", async () => {
    const { dir, manager, exits } = setup();
    manager.spawn("long", { cmd: node, args: ["-e", "setInterval(()=>{}, 1000)"] }, { cwd: dir });
    expect(manager.isRunning("long")).toBe(true);
    manager.resize("long", 100, 40);
    manager.resize("long", 0, 0);
    manager.kill("long");
    await until(() => exits["long"] !== undefined);
    expect(manager.isRunning("long")).toBe(false);
  });

  it("rotates the log at 5 MB", async () => {
    const { dir, manager, chunks, exits } = setup();
    const logs = join(dir, "sessions");
    writeFileSync(join(logs, "big.log"), "x".repeat(5 * 1024 * 1024 + 10));
    manager.spawn(
      "big",
      { cmd: node, args: ["-e", "console.log('after rotation')"] },
      { cwd: dir },
    );
    await until(
      () => exits["big"] !== undefined && (chunks["big"] ?? "").includes("after rotation"),
    );
    expect(existsSync(join(logs, "big.log.1"))).toBe(true);
    expect(readFileSync(join(logs, "big.log"), "utf8")).toContain("after rotation");
  });
});
