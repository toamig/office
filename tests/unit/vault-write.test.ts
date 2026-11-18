import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { loadWorkspaceFile } from "../../src/main/core/workspace";
import { VaultOps } from "../../src/main/modules/vault/ops";
import { VaultService } from "../../src/main/modules/vault/service";
import {
  VaultWriteError,
  VaultWriter,
  type WriterWarning,
} from "../../src/main/modules/vault/writer";
import { cloneOf, sh } from "../fixtures/repos/make";
import { makeWorld } from "../fixtures/vault/make";

function setup() {
  const world = makeWorld();
  const loaded = loadWorkspaceFile(join(world.hub, world.workspaceConfigPath));
  if (!loaded.ok) throw new Error(loaded.error);
  const warnings: WriterWarning[] = [];
  const vault = new VaultService({
    bus: new Bus(),
    workspace: () => loaded.workspace,
    workspaceRoot: () => world.hub,
  });
  const writer = new VaultWriter({
    hubRoot: () => world.hub,
    onWarning: (w) => warnings.push(w),
    today: () => "2026-11-19",
  });
  const ops = new VaultOps({ vault, writer, workspace: () => loaded.workspace });
  const alphaRepo = join(world.hub, "Alpha");
  const file = join(alphaRepo, "OpenItems.md");
  return { world, vault, ops, warnings, alphaRepo, file };
}

describe("vault writer", () => {
  it("ticking done changes the file by exactly one line and commits only that file", async () => {
    const { ops, alphaRepo, file, world } = setup();
    const before = readFileSync(file, "utf8");
    // Another file is staged in the same repo; it must not be part of the commit.
    writeFileSync(
      join(alphaRepo, "Overview.md"),
      `${readFileSync(join(alphaRepo, "Overview.md"), "utf8")}\nextra\n`,
    );
    sh(alphaRepo, "add", "Overview.md");
    writeFileSync(join(alphaRepo, "untracked.md"), "x");

    const raw = "- [ ] 2026-11-17 Review the three blog drafts";
    const result = await ops.tickWaiting("alpha", raw);
    expect(result).toMatchObject({ committed: true, pushed: true, validateErrors: [] });

    const after = readFileSync(file, "utf8");
    expect(after).toBe(before.replace(`${raw}\n`, ""));
    expect(before.split("\n").length - after.split("\n").length).toBe(1);
    const shown = sh(alphaRepo, "show", "--name-only", "--format=%s", "HEAD");
    expect(shown.split("\n").filter(Boolean)).toEqual([
      "Alpha: done: Review the three blog drafts",
      "OpenItems.md",
    ]);
    expect(sh(alphaRepo, "status", "--porcelain")).toContain("Overview.md");
    expect(sh(world.remotes["Alpha"] as string, "log", "-1", "--format=%s").trim()).toBe(
      "Alpha: done: Review the three blog drafts",
    );
  });

  it("adds a dated waiting line and a quick note", async () => {
    const { ops, vault, file } = setup();
    await ops.addWaiting("alpha", "Pick the art style", "from Explore");
    expect(vault.read("alpha").waiting.map((w) => w.raw)).toContain(
      "- [ ] 2026-11-19 Pick the art style (from Explore)",
    );
    await ops.addNote("alpha", "  remember the   sheep ");
    expect(readFileSync(file, "utf8")).toContain(
      "## Notes to file\n\n- 2026-11-19 remember the sheep\n",
    );
  });

  it("creates the Waiting on you section for a project that has none", async () => {
    const { ops, vault } = setup();
    await ops.addWaiting("beta", "First item");
    expect(vault.read("beta").waiting).toHaveLength(1);
  });

  it("creates a project's OpenItems file from the starter when it does not exist yet", async () => {
    const { ops, vault, world } = setup();
    const betaRepo = join(world.hub, "Beta");
    sh(betaRepo, "rm", "-q", "OpenItems.md");
    sh(betaRepo, "commit", "-q", "-m", "remove OpenItems");
    sh(betaRepo, "push", "-q");
    expect(existsSync(join(betaRepo, "OpenItems.md"))).toBe(false);

    const result = await ops.addWaiting("beta", "First item");
    expect(result).toMatchObject({ committed: true, pushed: true });
    const text = readFileSync(join(betaRepo, "OpenItems.md"), "utf8");
    expect(text).toContain("type: openitems");
    expect(text).toContain("## Waiting on you");
    expect(vault.read("beta").waiting).toHaveLength(1);
    await ops.addNote("beta", "and a note");
    expect(readFileSync(join(betaRepo, "OpenItems.md"), "utf8")).toContain("and a note");
  });

  it("says so, instead of crashing, when a file does not exist and has no starter", async () => {
    const { world } = setup();
    const writer = new VaultWriter({ hubRoot: () => null, onWarning: () => undefined });
    await expect(
      writer.edit(join(world.hub, "Beta", "Nope.md"), "x", (c) => `${c}z`),
    ).rejects.toThrow(/does not exist yet/);
  });

  it("a push failure keeps the commit and becomes a warning, not a crash", async () => {
    const { ops, warnings, alphaRepo } = setup();
    sh(alphaRepo, "remote", "set-url", "--push", "origin", join(alphaRepo, "..", "nowhere.git"));
    const result = await ops.tickWaiting("alpha", "- [ ] 2026-11-17 Review the three blog drafts");
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeTruthy();
    expect(warnings.map((w) => w.kind)).toEqual(["push-failed"]);
    expect(sh(alphaRepo, "log", "-1", "--format=%s").trim()).toContain("done:");
  });

  it("aborts when the pull fails and reports it", async () => {
    const { ops, warnings, alphaRepo } = setup();
    sh(alphaRepo, "remote", "set-url", "origin", join(alphaRepo, "..", "nowhere.git"));
    const before = sh(alphaRepo, "rev-parse", "HEAD");
    await expect(
      ops.tickWaiting("alpha", "- [ ] 2026-11-17 Review the three blog drafts"),
    ).rejects.toThrow(/Could not update/);
    expect(sh(alphaRepo, "rev-parse", "HEAD")).toBe(before);
    expect(warnings.map((w) => w.kind)).toEqual(["write-failed"]);
  });

  it("pulls remote changes first, so a write never overwrites them", async () => {
    const { ops, world, alphaRepo, file } = setup();
    const other = cloneOf(
      { root: world.root, bare: world.remotes["Alpha"] as string, work: alphaRepo },
      "alpha-other",
    );
    writeFileSync(join(other, "Other.md"), "from another machine\n");
    sh(other, "add", "Other.md");
    sh(other, "commit", "-q", "-m", "other machine");
    sh(other, "push", "-q");
    await ops.addWaiting("alpha", "Fresh item");
    expect(readFileSync(join(alphaRepo, "Other.md"), "utf8")).toBe("from another machine\n");
    expect(readFileSync(file, "utf8")).toContain("Fresh item");
  });

  it("reports a missing line and surfaces a validate error", async () => {
    const { ops, world, warnings } = setup();
    await expect(ops.tickWaiting("alpha", "- [ ] 2020-01-01 not there")).rejects.toThrow(
      /no longer in the file/,
    );
    writeFileSync(join(world.hub, "FAIL_VALIDATE"), "");
    const result = await ops.addWaiting("alpha", "Trigger validate");
    expect(result.validateErrors).toEqual(["Alpha/OpenItems.md: broken link [[Alpha/Missing]]"]);
    expect(warnings.map((w) => w.kind)).toContain("validate");
  });

  it("refuses to write a file that has changes of the owner's that are not committed", async () => {
    const { ops, alphaRepo, file } = setup();
    const edited = `${readFileSync(file, "utf8")}\nmy own unsaved thought\n`;
    writeFileSync(file, edited);
    const head = sh(alphaRepo, "rev-parse", "HEAD");
    await expect(ops.addWaiting("alpha", "Fresh item")).rejects.toThrow(/not committed yet/);
    expect(readFileSync(file, "utf8")).toBe(edited);
    expect(sh(alphaRepo, "rev-parse", "HEAD")).toBe(head);
  });

  it("never commits conflict markers when the owner's uncommitted edit conflicts with the update", async () => {
    const { ops, world, alphaRepo, warnings } = setup();
    const overview = join(alphaRepo, "Overview.md");
    const other = cloneOf(
      { root: world.root, bare: world.remotes["Alpha"] as string, work: alphaRepo },
      "alpha-other",
    );
    const original = readFileSync(overview, "utf8");
    writeFileSync(
      join(other, "Overview.md"),
      original.replace("# Alpha: overview", "# Alpha: theirs"),
    );
    sh(other, "add", "Overview.md");
    sh(other, "commit", "-q", "-m", "other machine");
    sh(other, "push", "-q");
    // The owner has an uncommitted edit of the same line in a different file than the one being written.
    writeFileSync(overview, original.replace("# Alpha: overview", "# Alpha: mine"));
    const head = sh(alphaRepo, "rev-parse", "HEAD");

    await expect(ops.addWaiting("alpha", "Fresh item")).rejects.toThrow(/conflict/);

    expect(sh(alphaRepo, "status", "--porcelain")).not.toMatch(/^(UU|AA|DU|UD)/m);
    expect(readFileSync(overview, "utf8")).not.toContain("<<<<<<<");
    expect(readFileSync(join(alphaRepo, "OpenItems.md"), "utf8")).not.toContain("Fresh item");
    // Nothing new was committed or pushed, and the owner's edit is kept in the stash.
    expect(sh(alphaRepo, "log", "-1", "--format=%s").trim()).toBe("other machine");
    expect(sh(alphaRepo, "rev-parse", "HEAD")).not.toBe(head); // the pull did fast-forward
    expect(sh(alphaRepo, "stash", "list")).toContain("autostash");
    expect(sh(alphaRepo, "show", "stash@{0}")).toContain("# Alpha: mine");
    expect(sh(world.remotes["Alpha"] as string, "log", "-1", "--format=%s").trim()).toBe(
      "other machine",
    );
    expect(warnings.map((w) => w.kind)).toContain("write-failed");
  });

  it("refuses a Co-Authored-By trailer", async () => {
    const { file } = setup();
    const writer = new VaultWriter({ hubRoot: () => null, onWarning: () => undefined });
    await expect(
      writer.edit(file, "x\n\nCo-Authored-By: someone", (c) => `${c}z`),
    ).rejects.toBeInstanceOf(VaultWriteError);
  });
});
