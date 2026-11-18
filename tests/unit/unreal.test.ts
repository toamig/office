import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findUproject } from "../../src/main/modules/projects/unreal";

describe("findUproject", () => {
  it("finds the .uproject at the top of a folder, whatever its case, and nothing otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "office-ue-"));
    expect(findUproject(dir)).toBeNull();
    expect(findUproject(join(dir, "missing"))).toBeNull();
    mkdirSync(join(dir, "Sub"));
    writeFileSync(join(dir, "Sub", "Hidden.uproject"), "{}");
    expect(findUproject(dir)).toBeNull();
    writeFileSync(join(dir, "Game.UPROJECT"), "{}");
    expect(findUproject(dir)).toBe(join(dir, "Game.UPROJECT"));
  });
});
