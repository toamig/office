import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { prepareLaunch, repoRoot, type LaunchOptions, type Prepared } from "../support/prepare";

export {
  FAKE_OWNER,
  pick,
  relayUrl,
  repoRoot,
  terminalText,
  useCleanGitConfig,
} from "../support/prepare";
export type { LaunchOptions } from "../support/prepare";

/** The notifications in the corner: the result of an action, which leaves by itself. */
export const toasts = (page: Page) => page.getByTestId("notification-toast");

/** Opens a page header's overflow menu and clicks one of its items. */
export async function pageMenu(page: Page, itemTestId: string): Promise<void> {
  await page.getByTestId("page-more").click();
  await page.getByTestId(itemTestId).click();
}

/** Clicks Sync all, and opens the report from the summary notification ("View details"). */
export async function syncAllReport(page: Page) {
  await page.getByTestId("sync-all").click();
  await toasts(page)
    .filter({ hasText: "Synced" })
    .getByRole("button", { name: "View details" })
    .click();
  return page.getByTestId("sync-report");
}

/** The Electron binary: run as plain Node (ELECTRON_RUN_AS_NODE), so the native modules load as built. */
const electronBinary = (): string => createRequire(__filename)("electron") as string;

const HOST_SCRIPT = join(repoRoot, "out-web", "host", "index.js");

let browserPromise: Promise<Browser> | null = null;
/** One headless Chromium per worker; every test gets its own context in it. */
const browser = (): Promise<Browser> =>
  (browserPromise ??= chromium.launch({ headless: true, args: ["--disable-gpu"] }));

interface Host {
  process: ChildProcess;
  port: number;
  token: string;
  /** The tail of what the host printed, for a failure message. */
  log: () => string;
  stop: () => Promise<void>;
}

function startHost(env: Record<string, string>, logFile: string): Promise<Host> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary(), [HOST_SCRIPT], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        OFFICE_HOST_CONTROL: "1",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let text = "";
    let ready = false;
    const onData = (chunk: Buffer): void => {
      appendFileSync(logFile, chunk);
      text += chunk.toString();
      if (text.length > 20_000) text = text.slice(-10_000);
      if (ready) return;
      const match = /OFFICE_HOST_READY (\{.*\})/.exec(text);
      if (!match) return;
      ready = true;
      const info = JSON.parse(match[1] as string) as { port: number; token: string };
      resolve({
        process: child,
        port: info.port,
        token: info.token,
        log: () => text,
        stop: () =>
          new Promise<void>((done) => {
            if (child.exitCode !== null) return done();
            const kill = setTimeout(() => child.kill(), 10_000);
            child.once("exit", () => {
              clearTimeout(kill);
              done();
            });
            // Closing its stdin is how the host is told its test is over; it shuts down in order.
            child.stdin?.end();
          }),
      });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      if (!ready) reject(new Error(`The test host exited (${code}) before it was ready:\n${text}`));
    });
    setTimeout(() => {
      if (!ready) {
        child.kill();
        reject(new Error(`The test host did not start in time:\n${text}`));
      }
    }, 60_000);
  });
}

/**
 * The part of an ElectronApplication the specs use, over a browser page and the test host. What needs Electron
 * itself (windows, native menus, the main process) is not here: those specs stay in the Electron project.
 */
export interface WebApp {
  firstWindow(): Promise<Page>;
  close(): Promise<void>;
  /** Sets or removes environment variables in the host (test only), as `app.evaluate` did in the main process. */
  setEnv(env: Record<string, string | null>): Promise<void>;
  /** Scripts the host's next native menu or folder dialog, and reads what the shell was asked to do. */
  control(op: "menu" | "folder" | "calls", args?: unknown): Promise<unknown>;
}

export interface Launched extends Omit<Prepared, "env"> {
  app: WebApp;
  page: Page;
}

/** Starts a host on a fresh data folder and fake home, and opens its page in headless Chromium. */
export async function launch(options: LaunchOptions = {}): Promise<Launched> {
  // Hosts run side by side, so each takes free ports (the relay's included).
  const prepared = prepareLaunch(options, 0);
  const { env, ...rest } = prepared;
  const host = await startHost(env, join(rest.base, "host.log"));
  const context: BrowserContext = await (
    await browser()
  ).newContext({
    viewport: { width: 1360, height: 860 },
  });
  const page = await context.newPage();
  page.on("pageerror", (err) =>
    appendFileSync(
      join(rest.base, "page.log"),
      `pageerror: ${err.message}
`,
    ),
  );
  page.on("console", (m) =>
    appendFileSync(
      join(rest.base, "page.log"),
      `${m.type()}: ${m.text()}
`,
    ),
  );
  await page.goto(`http://127.0.0.1:${host.port}/?token=${host.token}`);

  const control = async (op: string, args?: unknown): Promise<unknown> =>
    page.evaluate(
      ([o, a]) =>
        (
          window as unknown as { __hostControl: (op: string, args?: unknown) => Promise<unknown> }
        ).__hostControl(o as string, a),
      [op, args] as const,
    );
  let closed = false;
  const app: WebApp = {
    firstWindow: async () => page,
    setEnv: async (vars) => void (await control("setenv", { env: vars })),
    control: (op, args) => control(op, args),
    close: async () => {
      if (closed) return;
      closed = true;
      await context.close();
      await host.stop();
    },
  };
  return { app, page, ...rest };
}

/** The dock specs put several sessions side by side, which Sessions only does when the owner turns it on. */
export async function allowSeveralSessions(page: Page): Promise<void> {
  await page.evaluate(() => window.office.invoke("settings.set", { sessionsMulti: true }));
}
