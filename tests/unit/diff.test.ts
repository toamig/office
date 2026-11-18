import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { getDiff, parseUnifiedDiff, untrackedAsDiff } from "../../src/main/modules/git/diff";
import { createWorktree } from "../../src/main/modules/git/worktrees";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { formatComments, sendReviewToAgent } from "../../src/main/modules/sessions/review";
import { SessionService } from "../../src/main/modules/sessions/service";
import type { Workspace } from "../../src/shared/types";
import { commit, makeRepoPair, sh, write } from "../fixtures/repos/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-diff-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

const SAMPLE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@ function x()",
  " keep",
  "-old line",
  "+new line",
  "+extra",
  " tail",
  "diff --git a/new.txt b/new.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/new.txt",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/old name.txt b/new name.txt",
  "similarity index 100%",
  "rename from old name.txt",
  "rename to new name.txt",
  "diff --git a/img.png b/img.png",
  "Binary files a/img.png and b/img.png differ",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("reads files, statuses, hunks and numbered lines", () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual([
      ["src/a.ts", "modified", 2, 1, false],
      ["new.txt", "added", 2, 0, false],
      ["gone.txt", "deleted", 0, 1, false],
      ["new name.txt", "renamed", 0, 0, false],
      ["img.png", "modified", 0, 0, true],
    ]);
    expect(files[3]?.oldPath).toBe("old name.txt");
    const hunk = files[0]?.hunks[0];
    expect(hunk?.header).toContain("@@ -1,3 +1,4 @@");
    expect(hunk?.lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text])).toEqual([
      ["ctx", 1, 1, "keep"],
      ["del", 2, null, "old line"],
      ["add", null, 2, "new line"],
      ["add", null, 3, "extra"],
      ["ctx", 3, 4, "tail"],
    ]);
  });

  it("caps very long files and flags them", () => {
    const body = Array.from({ length: 3100 }, (_, i) => `+line ${i}`).join("\n");
    const [file] = parseUnifiedDiff(
      `diff --git a/big b/big\nnew file mode 100644\n--- /dev/null\n+++ b/big\n@@ -0,0 +1,3100 @@\n${body}\n`,
    );
    expect(file?.truncated).toBe(true);
    expect(file?.hunks[0]?.lines).toHaveLength(3000);
  });

  it("turns an untracked file into an added-file diff", () => {
    const [file] = parseUnifiedDiff(untrackedAsDiff("notes/todo.md", "a\nb\n"));
    expect(file).toMatchObject({ path: "notes/todo.md", status: "added", additions: 2 });
  });
});

describe("getDiff on a fixture repo", () => {
  it("shows working changes (including new files), staged changes and a branch against its base", async () => {
    const pair = makeRepoPair();
    write(pair.work, "README.md", "# fixture\nsecond line\n");
    write(pair.work, "fresh.txt", "brand new\n");
    const working = await getDiff(pair.work, "working");
    expect(working.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ["README.md", "modified"],
      ["fresh.txt", "added"],
    ]);

    sh(pair.work, "add", "README.md");
    expect((await getDiff(pair.work, "staged")).files.map((f) => f.path)).toEqual(["README.md"]);
    sh(pair.work, "commit", "-q", "-m", "second line");

    sh(pair.work, "checkout", "-q", "-b", "topic");
    commit(pair.work, "topic.txt", "t\n", "topic work");
    const branch = await getDiff(pair.work, "branch", "main");
    expect(branch.files.map((f) => f.path)).toEqual(["topic.txt"]);
    await expect(getDiff(pair.work, "branch")).rejects.toThrow(/base branch/);
  });
});

describe("review comments", () => {
  it("formats one line per comment", () => {
    expect(
      formatComments([
        { file: "src/a.ts", line: 12, text: "rename this" },
        { file: "b.ts", line: 3, text: "multi\nline   note" },
      ]),
    ).toBe("src/a.ts:12: rename this\nb.ts:3: multi line note");
  });

  it("writes the message into the running session in that worktree, or starts a builder there", async () => {
    const pair = makeRepoPair();
    const made = await createWorktree(pair.work, "review me");
    const ws: Workspace = {
      version: 1,
      vault: { kind: "none", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
      projects: [],
      roles: {
        builder: {
          provider: "fake",
          model: "sonnet",
          instructions: "Build.",
          readOnly: false,
          allowedCommands: [],
        },
      },
      pipelines: {},
      notifications: { urgent: [], mutedProjects: [] },
      automations: [],
      archiveAfterDays: 7,
      briefTime: "08:00",
    };
    const db = openDb(":memory:");
    const bus = new Bus();
    const sessions = new SessionService({
      db,
      bus,
      providers: new ProviderRegistry(),
      notifier: new Notifier({ db, bus, workspace: () => ws, quietHours: () => undefined }),
      workspace: () => ws,
      projectPath: () => pair.work,
      logsDir: join(pair.root, "logs"),
    });
    const comments = [
      { file: "a.ts", line: 4, text: "first" },
      { file: "b.ts", line: 9, text: "second" },
    ];

    // No session there yet: a builder session starts with the comments as its first prompt.
    const started = sendReviewToAgent({ sessions, workspace: () => ws }, "p", made.path, comments);
    expect(started.started).toBe(true);
    expect(sessions.get(started.sessionId)).toMatchObject({ cwd: made.path, role: "builder" });
    for (
      let i = 0;
      i < 100 && !sessions.history(started.sessionId).data.includes("echo: Please address");
      i++
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(sessions.history(started.sessionId).data).toContain("a.ts:4: first");

    // A running session in the worktree now owns the changes: the message goes straight into it.
    const sent = sendReviewToAgent({ sessions, workspace: () => ws }, "p", made.path, comments);
    expect(sent).toEqual({ sessionId: started.sessionId, started: false });
    for (
      let i = 0;
      i < 100 && !sessions.history(started.sessionId).data.includes("echo: b.ts:9: second");
      i++
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const out = sessions.history(started.sessionId).data;
    expect(out).toContain("echo: a.ts:4: first");
    expect(out).toContain("echo: b.ts:9: second");
    expect(() => sendReviewToAgent({ sessions, workspace: () => ws }, "p", made.path, [])).toThrow(
      /at least one comment/,
    );
    sessions.shutdown();
  });
});
