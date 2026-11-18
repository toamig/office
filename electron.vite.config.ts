import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

const shared = resolve(__dirname, "src/shared");

/** The dev server needs inline scripts and a websocket; the production CSP stays strict. */
function devCsp(): Plugin {
  return {
    name: "office-dev-csp",
    apply: "serve",
    transformIndexHtml: (html) =>
      html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*" />`,
      ),
  };
}

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": shared } },
    build: { externalizeDeps: true },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
    // A sandboxed preload cannot require node_modules, so everything it imports is bundled.
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: { alias: { "@shared": shared } },
    plugins: [react(), tailwindcss(), devCsp()],
  },
});
