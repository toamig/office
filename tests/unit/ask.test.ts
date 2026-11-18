import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASK_SUFFIX,
  buildAskPrompt,
  extractCitations,
  readVaultFile,
} from "../../src/main/modules/ask/ask";
import { parseAuditEntries, readAudit } from "../../src/main/modules/vault/audit";
import { tmp } from "../fixtures/repos/make";
import { makeWorld } from "../fixtures/vault/make";

describe("ask prompt", () => {
  it("adds the standing rule, and the scope folder when one project is chosen", () => {
    const all = buildAskPrompt("  What is up?  ");
    expect(all).toBe(`What is up?\n\n${ASK_SUFFIX}`);
    expect(ASK_SUFFIX).toContain(
      "Follow Common/AGENTS.md: grep frontmatter first, read at most two files, cite the files you used.",
    );
    expect(buildAskPrompt("Q", "WebGames/Operator")).toContain(
      'only in the "WebGames/Operator" folder',
    );
  });
});

describe("citations", () => {
  it("finds wikilinks and plain paths, keeps only files that exist, and never escapes the vault", () => {
    const world = makeWorld();
    const text =
      "Alpha is a game. See [[Alpha/Overview]] and Alpha/OpenItems.md, also [[Alpha/Missing]], ../../etc/passwd.md and [[Alpha/Overview#Positioning|vision]].";
    expect(extractCitations(text, world.hub)).toEqual(["Alpha/Overview.md", "Alpha/OpenItems.md"]);
    expect(extractCitations("nothing cited", world.hub)).toEqual([]);
  });
});

describe("reading a cited note", () => {
  it("strips frontmatter and refuses paths outside the vault or not markdown", () => {
    const world = makeWorld();
    const note = readVaultFile(world.hub, "Alpha/Overview.md");
    expect(note.path).toBe("Alpha/Overview.md");
    expect(note.markdown.startsWith("# Alpha: overview")).toBe(true);
    expect(() => readVaultFile(world.hub, "../outside.md")).toThrow(/not a note inside/);
    expect(() => readVaultFile(world.hub, "Alpha/brain.json")).toThrow(/not a note inside/);
    expect(() => readVaultFile(world.hub, join(world.root, "x.md"))).toThrow(/not a note inside/);
    expect(() => readVaultFile(world.hub, "Alpha/Nope.md")).toThrow(/does not exist/);
    expect(() => readVaultFile("", "a.md")).toThrow(/No workspace/);
  });
});

describe("content audit", () => {
  it("lists entries under Currently open and treats Nothing as none", () => {
    expect(parseAuditEntries("# T\n\n## Currently open\n\nNothing.\n")).toEqual([]);
    expect(
      parseAuditEntries(
        "## Currently open\n\n- A says X\n  but B says Y\n- C vs D\n\n## Resolved\n- old\n",
      ),
    ).toEqual(["A says X but B says Y", "C vs D"]);
    expect(parseAuditEntries("no heading")).toEqual([]);
  });

  it("reads the audit file of the hub and of nested repos", () => {
    const world = makeWorld();
    writeFileSync(
      join(world.hub, "_ContentAudit.md"),
      "## Currently open\n\n- Hub level mismatch\n",
    );
    mkdirSync(join(world.hub, "Beta"), { recursive: true });
    writeFileSync(join(world.hub, "Beta", "_ContentAudit.md"), "## Currently open\n\nNothing.\n");
    writeFileSync(
      join(world.hub, "Alpha", "_ContentAudit.md"),
      "## Currently open\n\n- Alpha mismatch\n",
    );
    expect(readAudit(world.hub)).toEqual([
      { repo: "hub", entries: ["Hub level mismatch"] },
      { repo: "Alpha", entries: ["Alpha mismatch"] },
    ]);
    expect(readAudit(tmp())).toEqual([]);
    expect(readAudit("")).toEqual([]);
  });
});
