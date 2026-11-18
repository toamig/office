import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import {
  cleanMergedWorktrees,
  classify,
  createWorktree,
  listWorktrees,
  parseWorktrees,
  removeWorktree,
} from "../../src/main/modules/git/worktrees";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { SessionService } from "../../src/main/modules/sessions/service";
import { commit, makeRepoPair, sh, write } from "../fixtures/repos/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-wt-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

describe("parseWorktrees", () => {
  it("reads blocks with branch, detached HEAD, lock and prunable flags", () => {
    const out = [
      "worktree E:/repo",
      "HEAD abcdef1234567890",
      "branch refs/heads/main",
      "",
      "worktree E:/repo/.office/worktrees/task-a",
      "HEAD 1111111111111111",
      "branch refs/heads/office/task-a",
      "",
      "worktree E:/other/place",
      "HEAD 2222222222222222",
      "detached",
      "locked",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    const parsed = parseWorktrees(out);
    expect(parsed.map((w) => [w.path, w.branch, w.detached, w.locked, w.prunable])).toEqual([
      ["E:/repo", "main", false, false, false],
      ["E:/repo/.office/worktrees/task-a", "office/task-a", false, false, false],
      ["E:/other/place", null, true, true, true],
    ]);
  });

  it("classifies the main checkout, Office, the Claude app and others", () => {
    expect(classify("/r", "/r", 0)).toBe("main");
    expect(classify("/r", "/r/.office/worktrees/x", 1)).toBe("office");
    expect(classify("/r", "/r/.claude/worktrees/y", 2)).toBe("claude");
    expect(classify("/r", "/elsewhere/z", 3)).toBe("other");
  });
});

describe("worktrees on fixture repos", () => {
  it("creates an Office worktree, excludes .office through info/exclude, and lists it with its origin", async () => {
    const pair = makeRepoPair();
    const made = await createWorktree(pair.work, "Fix the Login Bug");
    expect(made.branch).toBe("office/fix-the-login-bug");
    expect(existsSync(join(made.path, "README.md"))).toBe(true);
    expect(sh(pair.work, "status", "--porcelain").trim()).toBe("");
    expect(readFileSync(join(pair.work, ".git", "info", "exclude"), "utf8")).toContain(".office/");
    expect(existsSync(join(pair.work, ".gitignore"))).toBe(false);

    mkdirSync(join(pair.work, ".claude", "worktrees"), { recursive: true });
    sh(
      pair.work,
      "worktree",
      "add",
      "-q",
      join(pair.work, ".claude", "worktrees", "app-made"),
      "-b",
      "claude/app-made",
    );
    const list = await listWorktrees(pair.work);
    expect(list[0]?.kind).toBe("main");
    expect(list.map((w) => [w.kind, w.branch]).sort()).toEqual([
      ["claude", "claude/app-made"],
      ["main", "main"],
      ["office", "office/fix-the-login-bug"],
    ]);
    await expect(createWorktree(pair.work, "Fix the Login Bug")).rejects.toThrow(/already exists/);
    await expect(createWorktree(pair.work, "!!!")).rejects.toThrow(/letters or digits/);
  });

  it("removes a clean worktree, refuses a dirty one, the main checkout and other tools' without confirm", async () => {
    const pair = makeRepoPair();
    const a = await createWorktree(pair.work, "task a");
    const b = await createWorktree(pair.work, "task b");
    write(b.path, "scratch.txt", "x");
    await expect(removeWorktree(pair.work, b.path)).rejects.toThrow(/uncommitted changes/);
    await removeWorktree(pair.work, a.path);
    expect(existsSync(a.path)).toBe(false);
    await expect(removeWorktree(pair.work, pair.work)).rejects.toThrow(/main checkout/);
    await expect(removeWorktree(pair.work, join(pair.root, "nowhere"))).rejects.toThrow(
      /does not belong/,
    );

    mkdirSync(join(pair.work, ".claude", "worktrees"), { recursive: true });
    const other = join(pair.work, ".claude", "worktrees", "app-made");
    sh(pair.work, "worktree", "add", "-q", other, "-b", "claude/app-made");
    await expect(removeWorktree(pair.work, other)).rejects.toThrow(/another tool/);
    await removeWorktree(pair.work, other, { confirmOther: true });
    expect(existsSync(other)).toBe(false);
  });

  it("cleans Office worktrees whose branch is merged and keeps the open ones", async () => {
    const pair = makeRepoPair();
    const merged = await createWorktree(pair.work, "merged one");
    const open = await createWorktree(pair.work, "open one");
    commit(merged.path, "m.txt", "m", "merged work");
    commit(open.path, "o.txt", "o", "open work");
    sh(pair.work, "merge", "-q", "--ff-only", merged.branch);
    expect(await cleanMergedWorktrees(pair.work)).toEqual(["office/merged-one"]);
    expect(existsSync(merged.path)).toBe(false);
    expect(existsSync(open.path)).toBe(true);
    expect(sh(pair.work, "branch", "--format=%(refname:short)")).not.toContain("office/merged-one");
    expect(sh(pair.work, "branch", "--format=%(refname:short)")).toContain("office/open-one");
  });

  it("opens an agent in a worktree: the session runs there and shows its branch", async () => {
    const pair = makeRepoPair();
    const made = await createWorktree(pair.work, "agent task");
    const db = openDb(":memory:");
    const bus = new Bus();
    const ws = null;
    const sessions = new SessionService({
      db,
      bus,
      providers: new ProviderRegistry(),
      notifier: new Notifier({ db, bus, workspace: () => ws, quietHours: () => undefined }),
      workspace: () => ws,
      projectPath: () => pair.work,
      logsDir: join(pair.root, "logs"),
    });
    const s = sessions.start({ providerId: "fake", cwd: made.path, title: "In worktree" });
    expect(s.cwd).toBe(made.path);
    for (let i = 0; i < 100 && !sessions.get(s.id).branch; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(sessions.get(s.id).branch).toBe("office/agent-task");
    sessions.shutdown();
  });
});
