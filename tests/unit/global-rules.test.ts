import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { GlobalRules, GLOBAL_RULE_FILES } from "../../src/main/modules/setup/global-rules";

it("leaves both global files byte for byte and waits before replacing a hand-edited block", () => {
  const base = mkdtempSync(join(tmpdir(), "office-global-rules-"));
  try {
    const root = join(base, "brain");
    cpSync(resolve("resources/brain-template"), root, { recursive: true });
    const home = join(base, "home");
    const originals = [Buffer.from("# Claude\r\nKeep this line\r\n"), Buffer.from("# Codex\r\nNo final newline")];
    const files = GLOBAL_RULE_FILES.map((entry, index) => {
      const file = join(home, entry.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, originals[index]!);
      return file;
    });
    const rules = new GlobalRules(() => root, () => home, join(base, "state.json"));
    const install = rules.preview();
    expect(install.changes).toHaveLength(2);
    rules.apply(install.id);
    const edited = readFileSync(files[0]!, "utf8").replace("Brain folder", "Edited by hand");
    writeFileSync(files[0]!, edited);
    const core = join(root, "Rules/Core.md");
    writeFileSync(core, readFileSync(core, "utf8") + "\nA new rule.\n");
    expect(rules.refresh()).toEqual(["Codex"]);
    expect(readFileSync(files[0]!, "utf8")).toBe(edited);
    expect(rules.pending()).toHaveLength(1);
    rules.undo();
    expect(rules.refresh()).toEqual([]);
    rules.apply(rules.preview(true).id);
    expect(files.map((file) => readFileSync(file))).toEqual(originals);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
