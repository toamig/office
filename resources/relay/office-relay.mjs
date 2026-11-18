// office-relay: tells the Office app about agent hook events. Plain Node, no dependencies.
//
//   node office-relay.mjs claude                      reads the Claude Code hook JSON on stdin
//   node office-relay.mjs codex [--chain <cmd...>] <json>
//                                                     Codex notify: forwards the event, then runs the
//                                                     original notify command (the --chain arguments)
//                                                     with the same JSON as its last argument
//
// A hook must never block or fail the agent: this script always exits 0, within about two seconds,
// even when Office is not running.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const TIMEOUT_MS = 2000;

function dataDir() {
  if (process.env.OFFICE_DATA) return process.env.OFFICE_DATA;
  const home = process.env.OFFICE_HOME || homedir();
  if (process.platform === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Office");
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Office");
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "Office");
}

function readRelayInfo() {
  try {
    const info = JSON.parse(readFileSync(join(dataDir(), "relay.json"), "utf8"));
    return info && info.port && info.token ? info : null;
  } catch {
    return null;
  }
}

function post(path, body) {
  return new Promise((resolve) => {
    const info = readRelayInfo();
    if (!info) return resolve(false);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: info.port,
        path,
        method: "POST",
        timeout: TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          authorization: `Bearer ${info.token}`,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode < 300));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end(body);
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let text = "";
    const timer = setTimeout(() => resolve(text), TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (text += d));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(text);
    });
    process.stdin.on("error", () => resolve(text));
  });
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "claude") {
    const body = (await readStdin()).trim();
    if (body) await post("/hook/claude", body);
    return;
  }
  if (mode === "codex") {
    const json = rest.length > 0 ? rest[rest.length - 1] : "{}";
    const middle = rest.slice(0, -1);
    const chainAt = middle.indexOf("--chain");
    const chain = chainAt >= 0 ? middle.slice(chainAt + 1) : [];
    await post("/hook/codex", json);
    if (chain.length > 0) {
      const [cmd, ...args] = chain;
      try {
        const child = spawn(cmd, [...args, json], { detached: true, stdio: "ignore", windowsHide: true });
        child.on("error", () => undefined);
        child.unref();
      } catch {
        /* the original notify command is best effort */
      }
    }
  }
}

const watchdog = setTimeout(() => process.exit(0), TIMEOUT_MS + 500);
watchdog.unref();
main()
  .catch(() => undefined)
  .finally(() => setTimeout(() => process.exit(0), 50));
