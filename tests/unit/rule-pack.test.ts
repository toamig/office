import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readRulePack, ruleBody, ruleCommand } from "../../src/main/modules/vault/rule-pack";

it("loads starter and owner packs and resolves the owner's placement section", () => {
  const root = mkdtempSync(join(tmpdir(), "office-rules-"));
  try {
    for (const [folder, source] of [["Rules", "office-starter@1"], ["Common", "own"]]) {
      mkdirSync(join(root, folder!));
      writeFileSync(join(root, folder!, "rules.json"), JSON.stringify({
        name: folder, source, read: `${folder}/AGENTS.md`, write: `${folder}/Authoring.md`,
        placement: `${folder}/Authoring.md#Placement`, templates: `${folder}/Templates.md`,
        load: [{ file: "Shared/Stack/Core.md", domain: "stack", where: "project" }],
        tools: { validate: `node "${folder}/tools/brain check.mjs" validate` },
      }));
      const pack = readRulePack(root)!;
      expect(pack.source).toBe(source);
      expect(ruleCommand(pack.tools.validate!)).toEqual(["node", `${folder}/tools/brain check.mjs`, "validate"]);
    }
    writeFileSync(join(root, "Common", "Authoring.md"), "# Authoring\n\n## Placement\n\nFile a decision in Decisions.\n\n## Other\nSeparate material.");
    expect(ruleBody(root, readRulePack(root)!.placement)).toBe("File a decision in Decisions.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
