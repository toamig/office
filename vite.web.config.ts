import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The renderer as a plain web page (plan 12.4), for the test host and `npm run dev:web`. The desktop build is
 * electron-vite's; this output is never packaged.
 */
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react(), tailwindcss()],
  // The Gallery is part of the web build, for the look check; the packaged app leaves it out.
  define: { "import.meta.env.VITE_GALLERY": JSON.stringify("1") },
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  build: {
    outDir: resolve(__dirname, "out-web/web"),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "src/renderer/web.html") },
  },
  server: { port: 5183, strictPort: false },
});
