import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { previewSnapshot, pruneSnapshots, restoreSnapshot, rewindRoot, saveSnapshot } from "../../src/main/modules/chat/rewind";

const fixtures: string[] = [];

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "office-rewind-fixture-"));
  fixtures.push(cwd);
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
  git("init", "-b", "fixture");
  git("config", "user.name", "Office fixture");
  git("config", "user.email", "office-test@localhost");
  git("config", "core.autocrlf", "false");
  return { root, git, write, session, message, snapshot: `refs/office/rewind/${session}/${message}` };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("restores binary and checkout line endings without changing ignored files, the index or branches", async () => {
  const { root, git, write, session, message } = fixture();
  write(".gitignore", "*.ignored\n");
  write(".gitattributes", "*.txt text eol=lf\ntracked.txt text eol=crlf\n");
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
}, 15_000);

it("stores the clean-filtered blob and restores through the snapshot's smudge filter", async () => {
  const { root, git, write, session, message, snapshot } = fixture();
  git("config", "filter.fixture.clean", `node -e 'process.stdout.write(require("fs").readFileSync(0,"utf8").replace("WORK_","STORED_"))'`);
  git("config", "filter.fixture.smudge", `node -e 'process.stdout.write(require("fs").readFileSync(0,"utf8").replace("STORED_","WORK_"))'`);
  git("config", "filter.fixture.required", "true");
  write(".gitattributes", "file.dat filter=fixture\n");
  write("file.dat", "WORK_initial\n");
  git("add", "--all");
  git("commit", "-m", "Fixture");
  write("file.dat", "WORK_before the turn\n");
  await saveSnapshot(root, session, message);
  expect(git("show", `${snapshot}:file.dat`).toString("utf8")).toBe("STORED_before the turn\n");
  write(".gitattributes", "file.dat -filter\n");
  write("file.dat", "unfiltered after the turn\n");
  const { revision } = await previewSnapshot(root, session, message);
  await restoreSnapshot(root, session, message, revision);
  expect(readFileSync(join(root, "file.dat"), "utf8")).toBe("WORK_before the turn\n");
}, 15_000);

it("names oversized untracked files and preserves them even if they have since shrunk", async () => {
  const { root, git, write, session, message, snapshot } = fixture();
  write("large [file].bin", "");
  truncateSync(join(root, "large [file].bin"), 50_000_001);
  write("small.txt", "before the turn\n");
  await saveSnapshot(root, session, message);
  expect(git("ls-tree", "-r", "--name-only", snapshot).toString("utf8")).toBe("small.txt\n");
  write("large [file].bin", "smaller after the turn\n");
  write("small.txt", "after the turn\n");
  write("other-large.bin", "");
  truncateSync(join(root, "other-large.bin"), 50_000_001);
  const { revision, files, omitted } = await previewSnapshot(root, session, message);
  expect(omitted).toEqual(["large [file].bin", "other-large.bin"]);
  expect(files).toEqual([{ path: "small.txt", action: "modify" }]);
  await restoreSnapshot(root, session, message, revision);
  expect(readFileSync(join(root, "large [file].bin"), "utf8")).toBe("smaller after the turn\n");
  expect(readFileSync(join(root, "small.txt"), "utf8")).toBe("before the turn\n");
}, 15_000);
