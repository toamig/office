import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { StarterPack } from "../../src/main/modules/vault/starter-pack";

it("updates untouched files, asks before replacing edited files, and can undo an automatic update", () => {
  const base = mkdtempSync(join(tmpdir(), "office-starter-pack-"));
  try {
    const template = join(base, "template");
    const brain = join(base, "brain");
    const state = join(base, "state");
    cpSync(resolve("resources/brain-template"), template, { recursive: true });
    cpSync(template, brain, { recursive: true });
    const rules = new StarterPack(brain, template, true, state);
    rules.trackCreation();
    const custom = "\nThe owner added a rule.\n";
    const edited = join(brain, "Rules/Core.md");
    const original = readFileSync(edited, "utf8");
    writeFileSync(edited, original + custom);
    expect(rules.status().conflicts).toEqual([]);

    const config = join(template, "Rules/rules.json");
    writeFileSync(config, readFileSync(config, "utf8").replace("office-starter@1", "office-starter@2"));
    writeFileSync(join(template, "Rules/Core.md"), original + "\nA new release rule.\n");
    const proposed = readFileSync(join(template, "Rules/Conventions.md"), "utf8") + "\nA new convention.\n";
    writeFileSync(join(template, "Rules/Conventions.md"), proposed);
    expect(rules.refresh()).toEqual(["Rules/rules.json", "Rules/Conventions.md"]);
    expect(readFileSync(edited, "utf8")).toBe(original + custom);
    const [conflict] = rules.status().conflicts;
    expect(conflict?.path).toBe("Rules/Core.md");
    expect(conflict?.diff).toContain("The owner added a rule.");
    rules.answer(conflict!.path, conflict!.before, conflict!.after, false);
    expect(rules.status().conflicts).toEqual([]);
    rules.undo();
    expect(readFileSync(join(brain, "Rules/Conventions.md"), "utf8")).not.toBe(proposed);
    expect(readFileSync(edited, "utf8")).toBe(original + custom);
    expect(rules.refresh()).toEqual([]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
