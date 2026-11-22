import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { createBrain } from "../../src/main/modules/onboarding/brain";
import { runRuleTool } from "../../src/main/modules/vault/rule-pack";

it("creates a starter brain with its own rule pack and standalone validation", async () => {
  const base = mkdtempSync(join(tmpdir(), "office-starter-smoke-"));
  vi.stubEnv("OFFICE_DATA", join(base, "office-data"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(base, "no-global-config"));
  vi.stubEnv("GIT_AUTHOR_NAME", "Fixture");
  vi.stubEnv("GIT_AUTHOR_EMAIL", "fixture@example.invalid");
  vi.stubEnv("GIT_COMMITTER_NAME", "Fixture");
  vi.stubEnv("GIT_COMMITTER_EMAIL", "fixture@example.invalid");
  try {
    const root = join(base, "brain");
    const made = await createBrain(resolve("resources/brain-template"), root, null);
    expect(made.files).toContain("Rules/tools/brain.mjs");
    const validation = await runRuleTool(root, "validate", 5000);
    expect(validation?.stdout).toContain("0 errors");
    expect(validation?.code).toBe(0);
    const routers = await runRuleTool(root, "reindexCheck", 5000);
    expect(routers?.code, routers?.stdout || routers?.stderr).toBe(0);
  } finally {
    vi.unstubAllEnvs();
    rmSync(base, { recursive: true, force: true });
  }
});
