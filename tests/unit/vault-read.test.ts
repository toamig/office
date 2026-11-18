import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import { readHub } from "../../src/main/modules/vault/hub";
import {
  parseHubStatus,
  parseValidate,
  readHubStatus,
  runValidate,
} from "../../src/main/modules/vault/health";
import {
  appendToSection,
  formatWaitingLine,
  parseOpenItems,
  removeWaitingLine,
} from "../../src/main/modules/vault/openitems";
import { VaultService } from "../../src/main/modules/vault/service";
import { makeWorld } from "../fixtures/vault/make";

describe("parseOpenItems", () => {
  const sample = [
    "---",
    "type: openitems",
    "---",
    "# Title",
    "",
    "## Waiting on you",
    "",
    "- [ ] 2026-11-18 Decide the balance (from the design review)",
    "- [ ] 2026-11-17 No source here",
    "stray text",
    "- [x] 2026-11-10 Ticked by hand",
    "",
    "## Todo",
    "- Plain bullet",
    "- [ ] Open box",
    "  - nested is ignored",
    "- [x] Done box",
    "",
    "## Waiting on you but not really",
    "- [ ] 2026-01-01 not parsed as waiting",
  ].join("\n");

  it("returns dated waiting items with optional source and keeps unparsed lines", () => {
    const parsed = parseOpenItems(sample);
    expect(parsed.waiting.map((w) => [w.date, w.text, w.source])).toEqual([
      ["2026-11-18", "Decide the balance", "from the design review"],
      ["2026-11-17", "No source here", undefined],
    ]);
    expect(parsed.unparsed.map((u) => u.text)).toEqual([
      "stray text",
      "- [x] 2026-11-10 Ticked by hand",
    ]);
  });

  it("turns every other section into a todo group of top-level bullets", () => {
    const groups = parseOpenItems(sample).groups;
    expect(groups.map((g) => g.heading)).toEqual(["Todo", "Waiting on you but not really"]);
    expect(groups[0]?.items).toEqual([
      { text: "Plain bullet", checked: null, line: 14 },
      { text: "Open box", checked: false, line: 15 },
      { text: "Done box", checked: true, line: 17 },
    ]);
  });

  it("returns nothing for a file without sections", () => {
    expect(parseOpenItems("# Just a title\n\nNothing yet.\n")).toEqual({
      waiting: [],
      unparsed: [],
      groups: [],
    });
  });
});

describe("openitems edits", () => {
  const doc =
    "# T\n\n## Waiting on you\n\n- [ ] 2026-11-18 A\n- [ ] 2026-11-17 B\n\n## Todo\n\n- x\n";

  it("removes exactly one line", () => {
    const next = removeWaitingLine(doc, "- [ ] 2026-11-18 A");
    expect(next).toBe("# T\n\n## Waiting on you\n\n- [ ] 2026-11-17 B\n\n## Todo\n\n- x\n");
    expect(removeWaitingLine(doc, "- [ ] 2026-11-18 missing")).toBeNull();
  });

  it("appends to the end of the section, before the blank line that follows it", () => {
    const next = appendToSection(
      doc,
      "Waiting on you",
      formatWaitingLine("2026-11-19", "C  ", "src"),
    );
    expect(next).toBe(
      "# T\n\n## Waiting on you\n\n- [ ] 2026-11-18 A\n- [ ] 2026-11-17 B\n- [ ] 2026-11-19 C (src)\n\n## Todo\n\n- x\n",
    );
  });

  it("creates the section before the first other section, or at the end", () => {
    const a = appendToSection(
      "# T\n\nIntro\n\n## Todo\n\n- x\n",
      "Waiting on you",
      "- [ ] 2026-11-19 N",
    );
    expect(a).toBe("# T\n\nIntro\n\n## Waiting on you\n\n- [ ] 2026-11-19 N\n\n## Todo\n\n- x\n");
    const b = appendToSection("# T\n\nNothing yet.\n", "Notes to file", "- 2026-11-19 a note");
    expect(b).toBe("# T\n\nNothing yet.\n\n## Notes to file\n\n- 2026-11-19 a note\n");
  });

  it("respects the CRLF line endings of a file that already has them", () => {
    const crlf = "# T\r\n\r\n## Waiting on you\r\n\r\n- [ ] 2026-11-18 A\r\n";
    const next = appendToSection(crlf, "Waiting on you", "- [ ] 2026-11-19 B");
    expect(next).toBe(
      "# T\r\n\r\n## Waiting on you\r\n\r\n- [ ] 2026-11-18 A\r\n- [ ] 2026-11-19 B\r\n",
    );
  });
});

describe("fixture vault", () => {
  it("lists nested repos, reads waiting items and todos, and counts them", () => {
    const world = makeWorld();
    expect(readHub(world.hub).map((r) => r.folder)).toEqual(["Common", "Alpha", "Beta", "Office"]);
    expect(readHub(world.hub)[1]?.depends).toEqual(["Common"]);

    const loaded = loadWorkspaceFile(join(world.hub, world.workspaceConfigPath));
    if (!loaded.ok) throw new Error(loaded.error);
    const service = new VaultService({
      bus: new Bus(),
      workspace: () => loaded.workspace,
      workspaceRoot: () => world.hub,
    });
    const alpha = service.read("alpha");
    expect(alpha.waiting.map((w) => w.text)).toEqual([
      "Decide the sheep and enemy balance",
      "Review the three blog drafts",
    ]);
    expect(alpha.waiting[0]?.source).toBe("from the design review session");
    expect(alpha.unparsed).toHaveLength(2);
    expect(alpha.groups.map((g) => g.heading)).toEqual(["Todo", "Implementation notes"]);
    expect(service.waitingCount("beta")).toBe(0);
    expect(service.allWaiting().map((w) => w.projectName)).toEqual(["Alpha", "Alpha"]);
    expect(service.read("missing").file).toBeNull();

    // A change on disk is noticed through the modification time.
    const file = service.openItemsFile("alpha");
    if (!file) throw new Error("no file");
    const before = readFileSync(file, "utf8");
    writeFileSync(file, before.replace("- [ ] 2026-11-17 Review the three blog drafts\n", ""));
    service.invalidate();
    expect(service.waitingCount("alpha")).toBe(1);
  });

  it("shows a fixture validate error and hub status rows", async () => {
    const world = makeWorld();
    expect(await runValidate(world.hub)).toMatchObject({ ran: true, ok: true, errors: [] });
    writeFileSync(join(world.hub, "FAIL_VALIDATE"), "");
    const failed = await runValidate(world.hub);
    expect(failed.ok).toBe(false);
    expect(failed.errors).toEqual(["Alpha/OpenItems.md: broken link [[Alpha/Missing]]"]);
    expect(failed.warnings).toBe(1);

    const rows = await readHubStatus(world.hub);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ folder: ".", state: "clean", attention: false });
  });
});

describe("health parsing", () => {
  it("parses validate output and hub status flags", () => {
    expect(
      parseValidate(
        "warn  x\nERROR bad one\n\nhub: 3 files, 1 errors, 1 warnings, 0 external links\n",
        1,
      ),
    ).toEqual({
      ran: true,
      ok: false,
      errors: ["bad one"],
      warnings: 1,
      summary: "hub: 3 files, 1 errors, 1 warnings, 0 external links",
    });
    const pad = (f: string, rest: string): string => `${f.padEnd(26)} ${rest}`;
    const rows = parseHubStatus(
      [
        pad(".", "2026-11-18  1 uncommitted"),
        pad("Polyglyph", "2026-11-03  2 to push, 1 to pull"),
        pad("Radar", "-  no origin"),
        "Ahead/behind counts use the last fetch; `sync` refreshes them.",
      ].join("\n"),
    );
    expect(rows).toEqual([
      {
        folder: ".",
        last: "2026-11-18",
        state: "1 uncommitted",
        uncommitted: 1,
        ahead: 0,
        behind: 0,
        attention: true,
      },
      {
        folder: "Polyglyph",
        last: "2026-11-03",
        state: "2 to push, 1 to pull",
        uncommitted: 0,
        ahead: 2,
        behind: 1,
        attention: true,
      },
      {
        folder: "Radar",
        last: "-",
        state: "no origin",
        uncommitted: 0,
        ahead: 0,
        behind: 0,
        attention: true,
      },
    ]);
  });
});
