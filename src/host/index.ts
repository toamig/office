import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createContext } from "../main/context";
import { UpdateService, type UpdaterLike } from "../main/core/update";
import { registerHandlers } from "../main/handlers";
import { registerShellHandlers } from "../main/shell-handlers";
import { createHostPlatform } from "./platform";
import { startHostServer } from "./server";

/**
 * The test host (plan 12.4): the real AppContext and handlers, with no windows, behind one localhost WebSocket
 * and the built web interface. Run as `ELECTRON_RUN_AS_NODE=1 electron out-web/host/index.js`, so the native
 * modules load as they are. It reads the same OFFICE_HOME, OFFICE_DATA and OFFICE_WORKSPACE as the app.
 * Never part of the packaged app.
 */
async function main(): Promise<void> {
  process.env["OFFICE_QUIET_IPC"] = "1";
  const here = __dirname;
  const relayScript =
    process.env["OFFICE_RELAY_SCRIPT"] ?? resolve(here, "../../resources/relay/office-relay.mjs");
  const staticDir = process.env["OFFICE_WEB_DIR"] ?? resolve(here, "../web");
  const token = process.env["OFFICE_HOST_TOKEN"] || randomBytes(16).toString("hex");

  const ctx = await createContext(true, relayScript);
  registerHandlers(ctx);
  const noUpdater: UpdaterLike = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: () => undefined,
    checkForUpdates: async () => undefined,
    quitAndInstall: () => undefined,
  };
  const updates = new UpdateService({
    updater: noUpdater,
    version: "0.1.0",
    enabled: false,
    disabledReason: "Updates are off while running against test data",
    onChange: (status) => ctx.bus.emit("app.update", status),
  });
  const { platform, state } = createHostPlatform(updates);
  registerShellHandlers(ctx, platform);

  const control =
    process.env["OFFICE_HOST_CONTROL"] === "1"
      ? async (op: string, args: unknown): Promise<unknown> => {
          const a = (args ?? {}) as Record<string, unknown>;
          if (op === "setenv") {
            for (const [k, v] of Object.entries(a["env"] as Record<string, string | null>)) {
              if (v === null) delete process.env[k];
              else process.env[k] = v;
            }
            return null;
          }
          if (op === "menu") state.menuAnswers.push((a["choose"] as string | null) ?? null);
          else if (op === "folder") state.folderAnswers.push((a["path"] as string | null) ?? null);
          else if (op === "calls") return state.calls;
          else throw new Error(`Unknown control ${op}`);
          return null;
        }
      : null;

  const server = await startHostServer({
    ctx,
    token,
    staticDir,
    ...(process.env["OFFICE_HOST_PORT"] ? { port: Number(process.env["OFFICE_HOST_PORT"]) } : {}),
    control,
  });
  ctx.bus.on("*", (event) => server.event(event));
  ctx.sessions.sink = (id, data, end) => server.pty(id, data, end);
  await ctx.start();

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      ctx.sessions.shutdown();
      await ctx.stop();
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  // The test that started the host is gone when its pipe closes.
  process.stdin.on("end", () => void shutdown());
  process.stdin.resume();

  // What the app does in the background after it starts is done before a test begins, so no test races it.
  await ctx.projects.refreshAll();
  console.log(`OFFICE_HOST_READY ${JSON.stringify({ port: server.port, token })}`);
}

main().catch((err) => {
  console.error("OFFICE_HOST_FAILED", err);
  process.exit(1);
});
