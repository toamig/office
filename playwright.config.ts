import { defineConfig } from "@playwright/test";

// The machine may be busy with other work, so the limits are generous; a healthy run is far faster.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 6,
  fullyParallel: true,
  reporter: "list",
});
