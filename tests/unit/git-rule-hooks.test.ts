import { chmodSync, copyFileSync, existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { run } from "../../src/main/core/exec";
import { git } from "../../src/main/modules/git/run";
import { GitRuleHooks } from "../../src/main/modules/setup/git-rule-hooks";
import { commit, sh, tmp, write } from "../fixtures/repos/make";

const check = resolve("resources/relay/office-check.mjs");

function fixture() {
  const root = tmp("office-git-rules-");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(root, "empty-config"));
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.email", "fixture@example.invalid");
  sh(root, "config", "user.name", "Fixture");
  sh(root, "config", "core.autocrlf", "false");
  return root;
}

it.each(["an exited process", "a live process with a lock older than five minutes"])("takes over the post-commit lock from %s", async (reason) => {
  const root = fixture();
  try {
    const lock = join(root, ".git", "office-post-commit.lock");
    const aged = reason.startsWith("a live");
    const oldOwner = aged ? String(process.pid) : (await run("node", ["-p", "process.pid"], { cwd: root })).stdout.trim();
    expect(oldOwner).toMatch(/^\d+$/);
    write(root, ".git/office-post-commit.lock/pid", oldOwner);
    if (aged) {
      const stale = new Date(Date.now() - 301_000);
      utimesSync(lock, stale, stale);
    }
    write(root, "Rules/rules.json", JSON.stringify({ tools: {
      sync: `node -e "const fs=require('fs'); const dir='.git/office-post-commit.lock/'; const owner=fs.readdirSync(dir)[0]; fs.writeFileSync('sync-ran',fs.readFileSync(dir+owner,'utf8')+'='+process.ppid)"`,
    } }));
    const result = await run("node", [check, "post-commit", root, "brain"], { cwd: root, env: { OFFICE_VAULT_WRITER: undefined }, timeoutMs: 5000 });
    expect(result).toMatchObject({ code: 0, stderr: "" });
    const [pid, parent] = readFileSync(join(root, "sync-ran"), "utf8").split("=");
    expect(pid).toMatch(/^\d+$/);
    expect(pid).toBe(parent);
    expect(pid).not.toBe(oldOwner);
    expect(existsSync(lock)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
}, 10_000);

it("chains the existing hook even if the Office script is missing and leaves its bytes untouched", async () => {
  const root = fixture();
  try {
    commit(root, "README.md", "Before\n");
    sh(root, "config", "core.hooksPath", "legacy hooks");
    const path = "legacy hooks/pre-commit";
    const original = "#!/bin/sh\nprintf 'legacy\\n' > hook-ran\nexit 0";
    write(root, path, original);
    chmodSync(join(root, path), 0o755);
    const copy = join(root, "check.mjs");
    copyFileSync(check, copy);
    const hooks = new GitRuleHooks(copy);
    await hooks.configure(root, root, "code", true);
    write(root, "bad.md", "\uFEFFBOM\n");
    sh(root, "add", "bad.md");
    expect((await git(root, ["commit", "-m", "Rejected"])).stderr).toContain("byte order mark");
    expect(existsSync(join(root, "hook-ran"))).toBe(true);
    rmSync(join(root, "hook-ran"));
    rmSync(copy);
    expect((await git(root, ["commit", "-m", "Missing Office"])).code).toBe(0);
    expect(readFileSync(join(root, "hook-ran"), "utf8")).toBe("legacy\n");
    await hooks.configure(root, root, "code", false);
    expect(sh(root, "config", "--local", "core.hooksPath").trim()).toBe("legacy hooks");
    expect(readFileSync(join(root, path))).toEqual(Buffer.from(original));
  } finally {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});

it("checks staged blobs and added prose, filters pack findings, and strips only the named trailer", async () => {
  const root = fixture();
  try {
    write(root, "Rules/rules.json", JSON.stringify({
      checks: { staged: ["utf8-no-bom", "lf", "no-dash-in-added-prose"], commitMsg: ["strip-co-authored-by"] },
      tools: { validate: "node Rules/validate.mjs" },
    }));
    write(root, "Rules/validate.mjs", [
      'import { readFileSync } from "node:fs";',
      'console.log("ERROR outside.md: unrelated finding");',
      'if (readFileSync("note.md", "utf8").includes("bad metadata")) console.log("ERROR note.md: bad metadata");',
      "process.exitCode = 1;",
    ].join("\n"));
    write(root, "note.md", "Existing \u2014 line\n");
    sh(root, "add", ".");
    sh(root, "commit", "-qm", "Baseline");
    const checkHook = (name: string, ...args: string[]) =>
      run("node", [check, name, root, "brain", ...args], { cwd: root });
    write(root, "note.md", "Existing \u2014 line\n```text\nCode \u2013 example\n```\n");
    sh(root, "add", "note.md");
    write(root, "note.md", "bad metadata and unstaged \u2014 text\n");
    write(root, "outside.md", "\uFEFFUnstaged\r\n");
    const ok = await checkHook("pre-commit");
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("outside.md");
    sh(root, "add", "note.md");
    const bad = await checkHook("pre-commit");
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("added prose");
    expect(bad.stderr).toContain("note.md: bad metadata");
    expect(bad.stderr).not.toContain("outside.md");
    const message = "Title\r\n\r\nCo-Authored-By: Fixture <f@example.invalid>\r\nSigned-off-by: Fixture\r\nLast line";
    const msg = join(root, "message");
    write(root, "message", message);
    expect((await checkHook("commit-msg", msg)).code).toBe(0);
    expect(readFileSync(msg, "utf8")).toBe("Title\r\n\r\nSigned-off-by: Fixture\r\nLast line");
  } finally {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});
