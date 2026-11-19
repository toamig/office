import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStatus, SyncAction, TaskStatus } from "../../src/shared/models";
import { iconOf, labelOf, STATUS, toneOf } from "../../src/shared/tone";

describe("toneOf", () => {
  it("knows every status the app can show", () => {
    const values = [
      ...SessionStatus.options,
      ...TaskStatus.options,
      ...SyncAction.options,
      // Steps of the project wizard, stages and builders of a task, headless runs, and the update check.
      "pending",
      "running",
      "skipped",
      "approved",
      "kept",
      "ok",
      "waiting",
      "installed",
      "not-installed",
      "logged-in",
      "not-logged-in",
      "missing",
      "update-available",
      "unsaved",
      "saved",
      "folder-missing",
      "not-a-repo",
      "ahead",
      "behind",
      "archived",
      "passed",
      "in-sync",
      "info",
    ];
    for (const v of values) expect(STATUS[v], `${v} has no tone`).toBeDefined();
  });

  it("has every status a view names as a literal", () => {
    const root = resolve(__dirname, "../../src/renderer/src");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const missing: string[] = [];
    for (const file of walk(root).filter((p) => p.endsWith(".tsx"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<StatusBadge[^>]*?\bstatus="([a-z-]+)"/gs))
        if (!STATUS[m[1] as string]) missing.push(`${file}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("makes good outcomes green, never grey", () => {
    for (const v of [
      "done",
      "up-to-date",
      "pushed",
      "pulled",
      "installed",
      "logged-in",
      "in-sync",
      "saved",
      "passed",
    ])
      expect(toneOf(v), v).toBe("success");
  });

  it("keeps grey for inactive and neutral things only", () => {
    for (const [v, e] of Object.entries(STATUS)) {
      if (e.tone === "neutral")
        expect(["idle", "exited", "cancelled", "pending", "skipped", "archived"], v).toContain(v);
    }
  });

  it("uses amber only when the owner should act, and red only for a failure", () => {
    for (const v of [
      "needs-you",
      "waiting-gate",
      "waiting-permission",
      "behind",
      "unsaved",
      "update-available",
      "not-installed",
    ])
      expect(toneOf(v), v).toBe("attention");
    for (const v of ["failed", "conflict", "missing", "folder-missing"])
      expect(toneOf(v), v).toBe("danger");
    expect(toneOf("up-to-date")).not.toBe("danger");
  });

  it("says each status in a word, and gives an unknown value a sentence-case word and a neutral tone", () => {
    expect(labelOf("needs-you")).toBe("Needs you");
    expect(labelOf("up-to-date")).toBe("Up to date");
    expect(labelOf("some-new-thing")).toBe("Some new thing");
    expect(toneOf("some-new-thing")).toBe("neutral");
  });

  it("pairs every tone with an icon, so colour is never the only signal", () => {
    expect(iconOf("success")).toBe("check");
    expect(iconOf("danger")).toBe("cross");
    expect(iconOf("neutral", "idle")).toBe("dot");
    expect(iconOf("working")).toBe("spinner");
  });
});
