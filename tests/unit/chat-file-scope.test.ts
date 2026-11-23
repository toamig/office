import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scopedFile, type FileScope } from "../../src/main/modules/chat/files";

let base = "";
let scope: FileScope;
let project: string;
let outside: string;

const refused = (path: string) => expect(scopedFile(scope, path)).rejects.toMatchObject({ code: "file-scope" });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "office-file-scope-"));
  project = join(base, "project");
  outside = join(base, "outside");
  const brain = join(base, "brain");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(brain, "Notes"), { recursive: true });
  mkdirSync(join(brain, "Private"), { recursive: true });
  writeFileSync(join(project, "src", "page.html"), "<p>ok</p>");
  writeFileSync(join(project, ".git", "config"), "[core]");
  writeFileSync(join(outside, "secret.txt"), "secret");
  writeFileSync(join(brain, "Notes", "a.md"), "# note");
  writeFileSync(join(brain, "Private", "diary.md"), "# diary");
  scope = { cwd: project, roots: [project, brain], private: [join(brain, "Private")] };
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("the chat file protocol", () => {
  it("serves files inside the project and the brain, by relative or absolute path", async () => {
    const page = await scopedFile(scope, "src/page.html");
    expect(page.toLowerCase()).toBe(resolve(project, "src", "page.html").toLowerCase());
    await expect(scopedFile(scope, join(base, "brain", "Notes", "a.md"))).resolves.toBeTruthy();
    await expect(scopedFile(scope, pathToFileURL(join(project, "src", "page.html")).href)).resolves.toBeTruthy();
  });

  it("refuses .. in any form", async () => {
    await refused("../outside/secret.txt");
    await refused("src/../../outside/secret.txt");
    await refused("src\\..\\..\\outside\\secret.txt");
    await refused(`${pathToFileURL(join(project, "src")).href}/%2e%2e/%2e%2e/outside/secret.txt`);
  });

  it("refuses absolute paths and file URLs outside the allowed folders", async () => {
    await refused(join(outside, "secret.txt"));
    await refused(pathToFileURL(join(outside, "secret.txt")).href);
    await refused(process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts");
    await refused("");
    await refused("src/page.html\0.png");
  });

  it("refuses a link or Windows junction that leaves the folder", async () => {
    // A junction needs no privilege on Windows; on other systems the same call makes a plain directory link.
    symlinkSync(outside, join(project, "linked"), "junction");
    await refused("linked/secret.txt");
    await refused(join(project, "linked", "secret.txt"));
    try {
      symlinkSync(join(outside, "secret.txt"), join(project, "file-link.txt"), "file");
    } catch {
      return; // Creating a file symlink needs developer mode on Windows; the junction case above already ran.
    }
    await refused("file-link.txt");
  });

  it("refuses the private brain folders, even by a link that stays inside the brain", async () => {
    await refused(join(base, "brain", "Private", "diary.md"));
    symlinkSync(join(base, "brain", "Private"), join(base, "brain", "Notes", "alias"), "junction");
    await refused(join(base, "brain", "Notes", "alias", "diary.md"));
  });

  it("refuses .git and anything inside it", async () => {
    await refused(".git/config");
    await refused(join(project, ".git", "config"));
    await refused(join(project, ".GIT", "config"));
  });

  it("refuses a missing file and a folder", async () => {
    await refused("src/missing.html");
    await refused("src");
  });
});
