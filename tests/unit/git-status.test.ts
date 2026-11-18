import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { ProjectService } from "../../src/main/modules/git/service";
import { parseStatusV2, readLastCommit, readStatus } from "../../src/main/modules/git/status";
import { cloneOf, commit, makeRepoPair, sh, tmp, write } from "../fixtures/repos/make";

const NUL = "\0";

describe("parseStatusV2 (captured samples)", () => {
  it("reads branch, upstream and ahead/behind", () => {
    const out = [
      "# branch.oid abc123",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "",
    ].join(NUL);
    expect(parseStatusV2(out)).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      oid: "abc123",
    });
  });

  it("handles a detached HEAD", () => {
    const out = ["# branch.oid abc123", "# branch.head (detached)", ""].join(NUL);
    expect(parseStatusV2(out)).toMatchObject({
      branch: null,
      detached: true,
      upstream: null,
      ahead: 0,
    });
  });

  it("handles no upstream and an initial repo", () => {
    const out = ["# branch.oid (initial)", "# branch.head main", ""].join(NUL);
    expect(parseStatusV2(out)).toMatchObject({
      branch: "main",
      oid: null,
      upstream: null,
      behind: 0,
    });
  });

  it("parses ordinary, renamed (with original path), unmerged and untracked entries", () => {
    const out = [
      "# branch.oid abc",
      "# branch.head feature/x",
      "1 .M N... 100644 100644 100644 aaa bbb src/a file.ts",
      "1 A. N... 000000 100644 100644 000 bbb new.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 renamed.ts",
      "old name.ts",
      "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
      "? untracked dir/file.txt",
      "",
    ].join(NUL);
    const status = parseStatusV2(out);
    expect(status.files.map((f) => [f.kind, f.path])).toEqual([
      ["ordinary", "src/a file.ts"],
      ["ordinary", "new.ts"],
      ["renamed", "renamed.ts"],
      ["unmerged", "conflict.ts"],
      ["untracked", "untracked dir/file.txt"],
    ]);
    expect(status.files[2]?.origPath).toBe("old name.ts");
    expect(status).toMatchObject({ staged: 2, unstaged: 1, untracked: 1, conflicted: 1 });
  });
});

describe("readStatus against real fixture repos", () => {
  it("reports branch, counts and ahead/behind", async () => {
    const pair = makeRepoPair();
    commit(pair.work, "a.txt", "a", "local one");
    commit(pair.work, "b.txt", "b", "local two");
    const other = cloneOf(pair);
    commit(other, "c.txt", "c", "remote one");
    sh(other, "push", "-q");
    sh(pair.work, "fetch", "-q");
    write(pair.work, "README.md", "# edited\n");
    write(pair.work, "new.txt", "x");

    const result = await readStatus(pair.work);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      unstaged: 1,
      untracked: 1,
    });
    const last = await readLastCommit(pair.work);
    expect(last?.subject).toBe("local two");
  });

  it("reports an error for a folder that is not a repo", async () => {
    const result = await readStatus(tmp("office-notrepo-"));
    expect(result.ok).toBe(false);
  });
});

describe("ProjectService", () => {
  it("lists projects with git state, missing folders and non-repos", async () => {
    const pair = makeRepoPair();
    write(pair.work, "dirty.txt", "x");
    const root = tmp("office-projects-");
    mkdirSync(join(root, "plain"));
    const service = new ProjectService({
      bus: new Bus(),
      projectsRoot: () => root,
      projects: () => [
        // An absolute path ignores the root when joined by resolve, which suits a fixture repo.
        { id: "repo", name: "Repo", path: pair.work, pinned: true, archived: false },
        { id: "plain", name: "Plain", path: "plain", pinned: false, archived: false },
        { id: "gone", name: "Gone", path: "does-not-exist", pinned: false, archived: false },
      ],
    });
    await service.refreshAll();
    const [repo, plain, gone] = service.list();
    expect(repo).toMatchObject({
      isRepo: true,
      branch: "main",
      changed: 1,
      ahead: 0,
      behind: 0,
      exists: true,
    });
    expect(plain).toMatchObject({ isRepo: false, exists: true, branch: null });
    expect(gone).toMatchObject({ isRepo: false, exists: false });
    const detail = await service.get("repo");
    expect(detail?.origin).toBe(pair.bare);
    expect(detail?.lastCommit?.subject).toBe("initial commit");
    expect(await service.get("nope")).toBeNull();
  });
});
