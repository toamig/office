import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMessage, commitFiles, pushCurrent } from "../../src/main/modules/git/commit";
import { commit, makeRepoPair, sh, tmp, write } from "../fixtures/repos/make";

describe("commit messages", () => {
  it("refuses empty messages and any Co-Authored-By trailer", () => {
    expect(() => checkMessage("  ")).toThrow(/commit message/);
    expect(() => checkMessage("Fix it\n\nCo-Authored-By: Someone <a@b.c>")).toThrow(
      /Co-Authored-By/,
    );
    expect(() => checkMessage("fix it\n\nco-authored-by: x")).toThrow(/Co-Authored-By/);
    expect(checkMessage("  Fix: a bug about co-authored-by text  ")).toBe(
      "Fix: a bug about co-authored-by text",
    );
  });
});

describe("commitFiles", () => {
  it("commits selected files only, leaving other changes and other staged files alone", async () => {
    const pair = makeRepoPair();
    commit(pair.work, "a.txt", "a1", "add a");
    commit(pair.work, "b.txt", "b1", "add b");
    write(pair.work, "a.txt", "a2");
    write(pair.work, "b.txt", "b2");
    write(pair.work, "new.txt", "brand new");
    write(pair.work, "other.txt", "not selected");
    sh(pair.work, "add", "other.txt");

    const result = await commitFiles(pair.work, ["a.txt", "new.txt"], "Selected files");
    expect(result.pushed).toBe(false);
    expect(
      sh(pair.work, "show", "--name-only", "--format=%s", "HEAD").split("\n").filter(Boolean),
    ).toEqual(["Selected files", "a.txt", "new.txt"]);
    const status = sh(pair.work, "status", "--porcelain");
    expect(status).toContain(" M b.txt");
    expect(status).toContain("A  other.txt");
    expect(status).not.toContain("a.txt");
    expect(result.hash).toBe(sh(pair.work, "rev-parse", "--short", "HEAD").trim());
  });

  it("commits a deleted file and pushes to the bare remote when asked", async () => {
    const pair = makeRepoPair();
    commit(pair.work, "gone.txt", "x", "add gone");
    sh(pair.work, "push", "-q");
    rmSync(join(pair.work, "gone.txt"));
    const result = await commitFiles(pair.work, ["gone.txt"], "Remove gone", { push: true });
    expect(result.pushed).toBe(true);
    expect(sh(pair.bare, "log", "-1", "--format=%s").trim()).toBe("Remove gone");
  });

  it("sets the upstream on the first push of a new branch", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "checkout", "-q", "-b", "fresh-branch");
    write(pair.work, "f.txt", "f");
    const result = await commitFiles(pair.work, ["f.txt"], "On a new branch", { push: true });
    expect(result.pushed).toBe(true);
    expect(sh(pair.bare, "branch", "--list", "fresh-branch")).toContain("fresh-branch");
    expect(sh(pair.work, "rev-parse", "--abbrev-ref", "@{u}").trim()).toBe("origin/fresh-branch");
  });

  it("keeps the commit and reports a failed push instead of crashing", async () => {
    const pair = makeRepoPair();
    sh(pair.work, "remote", "set-url", "origin", join(pair.root, "nowhere.git"));
    write(pair.work, "p.txt", "p");
    const result = await commitFiles(pair.work, ["p.txt"], "Push will fail", { push: true });
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeTruthy();
    expect(sh(pair.work, "log", "-1", "--format=%s").trim()).toBe("Push will fail");
  });

  it("refuses with no files, a bad message, or a folder that is not a repo", async () => {
    const pair = makeRepoPair();
    await expect(commitFiles(pair.work, [], "msg")).rejects.toThrow(/at least one file/);
    await expect(commitFiles(pair.work, ["README.md"], "")).rejects.toThrow(/commit message/);
    await expect(commitFiles(tmp(), ["x"], "msg")).rejects.toThrow();
    const out = await pushCurrent(tmp());
    expect(out.ok).toBe(false);
  });
});
