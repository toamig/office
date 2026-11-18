import net from "node:net";

export const COMMON_DEV_PORTS = [5173, 3000, 8080, 4200, 5000, 8000, 4173, 3001];

/** True when something accepts a TCP connection on 127.0.0.1:port within the timeout. */
export function portOpen(port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** The URL of the first local dev server found on the usual ports, or null. */
export async function detectDevServer(ports: number[] = COMMON_DEV_PORTS): Promise<string | null> {
  const results = await Promise.all(ports.map(async (p) => ((await portOpen(p)) ? p : null)));
  const found = results.find((p): p is number => p !== null);
  return found === undefined ? null : `http://localhost:${found}`;
}

/** Only web pages: a preview never opens files or other schemes. */
export function checkPreviewUrl(raw: string): string {
  let url: URL;
  try {
    // "localhost:3000" is a host and port, not a scheme; real schemes have "//" or are a known risky one.
    const hasScheme =
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ||
      /^(javascript|data|about|blob|mailto|file):/i.test(raw);
    url = new URL(hasScheme ? raw : `http://${raw}`);
  } catch {
    throw new Error("That is not a valid address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https pages can be previewed");
  }
  return url.toString();
}
