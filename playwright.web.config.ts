import { defineConfig } from "@playwright/test";

// The web project (plan 12.4): the real interface in headless Chromium against the test host. Every test starts
// its own host with its own folders, so tests run side by side.
export default defineConfig({
  testDir: "tests/web",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: true,
  workers: 12,
  reporter: "list",
});
