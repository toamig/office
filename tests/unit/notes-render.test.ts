import { describe, expect, it } from "vitest";
import {
  isRareNote,
  NOTE_SCHEME,
  parseWikiTarget,
  splitSections,
  wikiLabel,
  wikiToLinks,
} from "../../src/shared/notes";
import { frontmatterValue } from "../../src/main/modules/notes/notes";

describe("wiki links in a note", () => {
  it("reads the repo, the note and the heading", () => {
    expect(parseWikiTarget("Polyglyph/Pricing#Plans")).toEqual({
      repo: "Polyglyph",
      note: "Pricing",
      heading: "Plans",
    });
    expect(parseWikiTarget("Overview")).toEqual({ repo: null, note: "Overview", heading: null });
    expect(parseWikiTarget("Alpha/Overview.md")).toMatchObject({ note: "Overview" });
  });

  it("becomes ordinary links: no bracket syntax is left, and a label or the note's name is shown", () => {
    const out = wikiToLinks(
      "See [[Alpha/Overview#Vision]] and [[OpenItems|the open items]], or [[Beta/Notes]].",
    );
    expect(out).not.toContain("[[");
    expect(out).toContain(
      `[Overview, Vision](${NOTE_SCHEME}${encodeURIComponent("Alpha/Overview#Vision")})`,
    );
    expect(out).toContain(`[the open items](${NOTE_SCHEME}OpenItems)`);
    expect(out).toContain(`[Notes](${NOTE_SCHEME}${encodeURIComponent("Beta/Notes")})`);
    expect(wikiLabel("Alpha/Overview#Vision")).toBe("Overview, Vision");
  });

  it("leaves code alone: inline code and fenced blocks keep their brackets", () => {
    const text = "Use `[[x]]` here.\n\n```\n[[Note]]\n```\n\nBut [[Real]] links.";
    const out = wikiToLinks(text);
    expect(out).toContain("`[[x]]`");
    expect(out).toContain("```\n[[Note]]\n```");
    expect(out).toContain(`[Real](${NOTE_SCHEME}Real)`);
  });
});

describe("a long note folds by section", () => {
  it("keeps the title and the intro apart from the sections, and ignores headings inside code", () => {
    const split = splitSections(
      [
        "# Title",
        "",
        "Intro text.",
        "",
        "## One",
        "first",
        "",
        "```",
        "## not a heading",
        "```",
        "",
        "## Two",
        "second",
      ].join("\n"),
    );
    expect(split.intro).toBe("# Title\n\nIntro text.");
    expect(split.sections.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(split.sections[0]?.body).toContain("## not a heading");
    expect(split.sections[1]?.body).toBe("second");
    expect(splitSections("just text").sections).toEqual([]);
  });

  it("puts audits and implementation notes behind Show more", () => {
    expect(isRareNote("ContentAudit")).toBe(true);
    expect(isRareNote("Implementation")).toBe(true);
    expect(isRareNote("Overview")).toBe(false);
    expect(isRareNote("Overview", "audit")).toBe(true);
  });
});

describe("a note's own summary", () => {
  it("is read from its frontmatter, with quotes removed", () => {
    const text =
      '---\ntype: spec\nsummary: "Pricing for the game, in plain words."\n---\n\n# Pricing';
    expect(frontmatterValue(text, "summary")).toBe("Pricing for the game, in plain words.");
    expect(frontmatterValue(text, "type")).toBe("spec");
    expect(frontmatterValue("# No frontmatter", "summary")).toBeNull();
    expect(frontmatterValue("---\ntype: spec\n---\nbody", "summary")).toBeNull();
  });
});
