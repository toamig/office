import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { previewSnapshot, pruneSnapshots, restoreSnapshot, rewindRoot, saveSnapshot } from "../../src/main/modules/chat/rewind";

it("restores the fixture working tree byte for byte without changing ignored files, the index or branches", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "office-rewind-fixture-"));
  const home = join(cwd, "home");
  const root = join(cwd, "repo");
  mkdirSync(home);
  mkdirSync(root);
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(home, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "pipe" });
  const write = (file: string, value: string | Buffer) => writeFileSync(join(root, file), value);
  const session = randomUUID();
  const message = randomUUID();
  try {
    git("init", "-b", "fixture");
    git("config", "user.name", "Office fixture");
    git("config", "user.email", "office-test@localhost");
    git("config", "core.autocrlf", "false");
    write(".gitignore", "*.ignored\n");
    write(".gitattributes", "*.txt text eol=lf\n");
    write("tracked.txt", "base\n");
    write("deleted.txt", "initial\n");
    write("replace", "a file before the turn\n");
    git("add", "--all");
    git("commit", "-m", "Fixture");
    write("tracked.txt", "staged\n");
    git("add", "tracked.txt");
    const index = readFileSync(join(root, ".git", "index"));
    const branches = git("show-ref", "--heads");
    const head = git("symbolic-ref", "HEAD");
    const bytes = Buffer.from([0, 255, 31, 10]);
    write("tracked.txt", "working file\r\n");
    write("untracked.bin", bytes);
    write("leave.ignored", "ignored before\n");
    expect(rewindRoot(root)).toBe(root);
    await saveSnapshot(root, session, message);

    write("tracked.txt", "modified after snapshot\n");
    unlinkSync(join(root, "deleted.txt"));
    unlinkSync(join(root, "untracked.bin"));
    unlinkSync(join(root, "replace"));
    mkdirSync(join(root, "replace"));
    write("replace/child", "replaced a file with a directory\n");
    write("new.txt", "new file\n");
    write("leave.ignored", "ignored after\n");
    const { files, revision } = await previewSnapshot(root, session, message);
    expect(files).toEqual([
      { path: "deleted.txt", action: "create" }, { path: "new.txt", action: "delete" },
      { path: "replace", action: "create" }, { path: "replace/child", action: "delete" },
      { path: "tracked.txt", action: "modify" }, { path: "untracked.bin", action: "create" },
    ]);
    await restoreSnapshot(root, session, message, revision);
    expect(readFileSync(join(root, "tracked.txt"), "utf8")).toBe("working file\r\n");
    expect(readFileSync(join(root, "deleted.txt"), "utf8")).toBe("initial\n");
    expect(readFileSync(join(root, "untracked.bin"))).toEqual(bytes);
    expect(readFileSync(join(root, "replace"), "utf8")).toBe("a file before the turn\n");
    expect(existsSync(join(root, "new.txt"))).toBe(false);
    expect(readFileSync(join(root, "leave.ignored"), "utf8")).toBe("ignored after\n");
    expect(readFileSync(join(root, ".git", "index"))).toEqual(index);
    expect(git("show-ref", "--heads")).toEqual(branches);
    expect(git("symbolic-ref", "HEAD")).toEqual(head);
    await pruneSnapshots(root, session, []);
    expect(git("for-each-ref", "refs/office/").length).toBe(0);
  } finally {
    vi.unstubAllEnvs();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 15_000);
