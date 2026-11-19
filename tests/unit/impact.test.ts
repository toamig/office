import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadImpact, selectSpecs } from "../../scripts/impact.mjs";

const ROOT = resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (
      [
        "node_modules",
        ".git",
        "out",
        "out-web",
        "release",
        "test-results",
        "fake-gh-remotes",
        ".dev",
      ].includes(name)
    )
      return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const rel = (p: string): string => relative(ROOT, p).replaceAll("\\", "/");

describe("tests/impact.json", () => {
  const impact = loadImpact();
  const mapped = new Set(
    Object.values(impact.areas).flatMap((a) => [...(a.web ?? []), ...(a.electron ?? [])]),
  );

  it("lists only specs that exist", () => {
    for (const spec of mapped) expect(existsSync(join(ROOT, spec)), spec).toBe(true);
  });

  it("covers every spec: each one is run for at least one area", () => {
    const specs = [...files(join(ROOT, "tests", "web")), ...files(join(ROOT, "tests", "e2e"))]
      .map(rel)
      .filter((f) => f.endsWith(".spec.ts"));
    expect(specs.length).toBeGreaterThan(20);
    const missing = specs.filter((s) => !mapped.has(s));
    expect(missing).toEqual([]);
  });

  it("covers every source file: a change anywhere maps to an area, or to everything", () => {
    const all = [
      ...files(join(ROOT, "src")),
      ...files(join(ROOT, "scripts")),
      ...files(join(ROOT, "tests")),
      ...files(join(ROOT, "resources")),
      ...files(join(ROOT, "examples")),
    ].map(rel);
    expect(selectSpecs(all, impact).unmapped).toEqual([]);
  });

  it("picks the specs of the area a change is in", () => {
    const inbox = selectSpecs(["src/renderer/src/views/Inbox.tsx"], impact);
    expect(inbox.fullWeb).toBe(false);
    expect(inbox.web).toContain("tests/web/inbox.spec.ts");
    const git = selectSpecs(["src/main/modules/git/sync.ts"], impact);
    expect(git.web).toContain("tests/web/git.spec.ts");
    expect(git.electron).toEqual([]);
  });

  it("runs everything for the shared parts", () => {
    for (const file of [
      "src/shared/ipc.ts",
      "src/main/core/db.ts",
      "src/preload/index.ts",
      "src/renderer/src/styles.css",
      "src/renderer/src/bridge/web-bridge.ts",
    ]) {
      expect(selectSpecs([file], impact).fullWeb, file).toBe(true);
    }
    expect(selectSpecs(["src/preload/index.ts"], impact).fullElectron).toBe(true);
  });

  it("runs a changed spec itself, and reports a file nothing covers", () => {
    expect(selectSpecs(["tests/web/chat.spec.ts"], impact).web).toEqual(["tests/web/chat.spec.ts"]);
    expect(selectSpecs(["tools/new-thing.ts"], impact).unmapped).toEqual(["tools/new-thing.ts"]);
  });
});
