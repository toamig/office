import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { spawnStream } from "../../src/main/core/exec";
import { parseClaudeLine, startAgentRun } from "../../src/main/modules/providers/stream";
import { RunService, type RunServiceDeps } from "../../src/main/modules/runs/service";

it("stops a background run and its child and retains output already emitted", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "office-run-stop-"));
  const runsDir = join(cwd, "runs");
  mkdirSync(runsDir);
  const heartbeat = join(cwd, "heartbeat");
  const stop = join(cwd, "stop");
  const db = openDb(":memory:");
  const childCode = `
    const { appendFileSync, existsSync } = require('node:fs');
    setInterval(() => {
      if (existsSync(process.argv[2])) process.exit(0);
      appendFileSync(process.argv[1], 'tick\\n');
    }, 40);
  `;
  const parentCode = `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', process.argv[1], process.argv[2], process.argv[3]], { stdio: 'ignore', windowsHide: true });
    console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'partial output'}]}}));
    const { existsSync } = require('node:fs');
    setInterval(() => { if (existsSync(process.argv[3])) process.exit(0); }, 40);
  `;
  const service = new RunService({
    db, runsDir, bus: new Bus(),
    providers: { get: () => ({
      headless: () => startAgentRun(spawnStream(process.execPath, ["-e", parentCode, childCode, heartbeat, stop], { cwd }), parseClaudeLine),
    }) },
  } as unknown as RunServiceDeps);
  const run = service.start({ kind: "workflow", providerId: "fixture", cwd, prompt: "Fixture", title: "Stop fixture" });
  try {
    expect(service.background(false)).toMatchObject([{ id: run.id, status: "running" }]);
    await expect.poll(() => {
      try { return readFileSync(heartbeat, "utf8").trim().split("\n").length; }
      catch { return 0; }
    }).toBeGreaterThan(1);
    service.cancel(run.id);
    expect(await run.result).toMatchObject({ ok: false, error: "cancelled", resultText: "partial output" });
    expect(service.background(true)).toMatchObject([{ id: run.id, title: "Stop fixture", status: "stopped" }]);
    expect(service.background(false)).toHaveLength(0);
    expect(readFileSync(join(run.dir, "result.md"), "utf8")).toBe("partial output\n");
    const ticks = readFileSync(heartbeat, "utf8");
    await delay(300);
    expect(readFileSync(heartbeat, "utf8")).toBe(ticks);
  } finally {
    writeFileSync(stop, "stop");
    await delay(120);
    db.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 8000);
