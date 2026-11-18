import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const shared = resolve(__dirname, "src/shared");

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
    plugins: [react(), tailwindcss()],
  },
});
