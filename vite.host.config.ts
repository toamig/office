import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * The test host as one Node script (plan 12.4): the app's own modules bundled, node_modules left to Node. It runs
 * under ELECTRON_RUN_AS_NODE=1, so the native modules load as built for Electron. Never part of the packaged app.
 */
export default defineConfig({
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  build: {
    ssr: resolve(__dirname, "src/host/index.ts"),
    outDir: resolve(__dirname, "out-web/host"),
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { format: "cjs", entryFileNames: "index.js" } },
  },
  ssr: { target: "node" },
});
