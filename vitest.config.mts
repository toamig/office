import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@shared": resolve(import.meta.dirname, "src/shared") } },
  test: {
    setupFiles: ["tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
