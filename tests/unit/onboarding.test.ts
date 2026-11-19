import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createBrain } from "../../src/main/modules/onboarding/brain";
import {
  hasPointer,
  installPointer,
  pointerBlock,
  removePointer,
} from "../../src/main/modules/onboarding/pointer";
import { OnboardingService } from "../../src/main/modules/onboarding/service";
import { findRepos, scanProjects, suggestName } from "../../src/main/modules/onboarding/scan";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import { loadWorkspaceFile } from "../../src/main/core/workspace";

const TEMPLATE = resolve(__dirname, "../../resources/brain-template");
const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));
const sh = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

function repo(dir: string, files: Record<string, string> = { "README.md": "# x\n" }): string {
  mkdirSync(dir, { recursive: true });
  sh(dir, "init", "-q", "-b", "main");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "first");
  return dir;
}

const block = pointerBlock({ name: "Alpha", brain: "Brain", notesFolder: "Projects/Alpha" });

describe("the agent pointer", () => {
  it("keeps every byte outside the markers through install and uninstall", () => {
    const originals = [
      null,
      "",
      "# Rules\n\nBe kind.\n",
      "no trailing newline",
      "ends with blank lines\n\n\n",
      "windows\r\nlines\r\n",
      "# Rules\n\n<!-- office:lead=1 -->\n",
    ];
    for (const original of originals) {
      const installed = installPointer(original, block);
      expect(hasPointer(installed)).toBe(true);
      expect(installed.startsWith(original ?? "")).toBe(true);
      expect(removePointer(installed)).toBe(original ?? "");
    }
  });

  it("names the notes without a path that only exists on this PC", () => {
    expect(block).toContain("`Brain`");
    expect(block).toContain("`Projects/Alpha`");
    expect(block).not.toMatch(/[A-Z]:\\|\/Users\//);
  });

  it("leaves text without the block alone", () => {
    expect(removePointer("# plain\n")).toBe("# plain\n");
  });
});

describe("scanning for projects", () => {
  it("lists repos up to two levels deep, skips known ones and worktrees, and names them", async () => {
    const root = tmp("office-scan-");
    repo(join(root, "Alpha"), { "package.json": '{"name":"@me/alpha-app"}' });
    repo(join(root, "Games", "Sheep"), { "Sheep.uproject": "{}" });
    repo(join(root, "Known"));
    const base = join(root, "Alpha");
    sh(base, "worktree", "add", "-q", "-b", "wt", join(root, "Alpha-wt"));
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
    repo(join(root, "node_modules", "dep", "x"));

    const found = await scanProjects(root, [join(root, "Known")], ["Projects/Sheep"]);
    expect(found.map((c) => c.name)).toEqual(["alpha-app", "Sheep"]);
    const sheep = found.find((c) => c.name === "Sheep");
    expect(sheep).toMatchObject({ group: "Games", notes: "Projects/Sheep" });
    expect(sheep?.lastCommit).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(findRepos(root).some((p) => p.endsWith("Alpha-wt"))).toBe(false);
    expect(suggestName(join(root, "Games", "Sheep"))).toBe("Sheep");
  });
});

describe("a new brain", () => {
  it("is one committed git repo with the template and an empty workspace", async () => {
    const dir = join(tmp("office-brain-"), "MyBrain");
    const result = await createBrain(TEMPLATE, dir, null);
    expect(result.files).toEqual(
      expect.arrayContaining([
        "README.md",
        "AGENTS.md",
        "Projects/README.md",
        "Office/workspace.json",
      ]),
    );
    expect(sh(dir, "log", "--format=%s").trim()).toBe("Start the brain");
    expect(sh(dir, "status", "--porcelain").trim()).toBe("");
    const loaded = loadWorkspaceFile(join(dir, "Office", "workspace.json"));
    expect(loaded.ok && loaded.workspace.projects).toEqual([]);
    expect(loaded.ok && loaded.workspace.vault.kind).toBe("folder");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("Waiting on you");
  });

  it("refuses a folder that has files in it", async () => {
    const dir = tmp("office-brain-full-");
    writeFileSync(join(dir, "x.txt"), "x");
    await expect(createBrain(TEMPLATE, dir, null)).rejects.toThrow(/already has files/);
  });
});

describe("adding projects", () => {
  async function setup() {
    const brain = join(tmp("office-add-"), "Brain");
    await createBrain(TEMPLATE, brain, null);
    const projectsRoot = tmp("office-add-projects-");
    const file = join(brain, "Office", "workspace.json");
    const state: { ws: ReturnType<typeof loadWorkspaceFile> } = { ws: loadWorkspaceFile(file) };
    const writer = new VaultWriter({ hubRoot: () => null, onWarning: () => undefined });
    const service = new OnboardingService({
      workspace: () => (state.ws.ok ? state.ws.workspace : null),
      workspaceRoot: () => brain,
      projectsRoot: () => projectsRoot,
      projectPaths: () => ({}),
      workspaceFile: () => file,
      reloadWorkspace: () => {
        state.ws = loadWorkspaceFile(file);
      },
      writer,
      templateDir: () => TEMPLATE,
      notesRepo: async () => {
        throw new Error("not used");
      },
    });
    return { brain, projectsRoot, service, file };
  }

  it("writes notes and the workspace entry in one commit per project, and lists what it will do first", async () => {
    const { brain, projectsRoot, service } = await setup();
    const a = repo(join(projectsRoot, "Alpha"));
    const b = repo(join(projectsRoot, "Beta"));
    const items = [
      { path: a, name: "Alpha", notes: "new" as const, group: "Games", domain: "saas" as const },
      { path: b, name: "Beta", notes: "none" as const, domain: "saas" as const },
    ];
    expect(service.plan(items)[0]).toContain("Projects/Alpha/Overview.md");
    const before = sh(brain, "rev-list", "--count", "HEAD").trim();
    const report = await service.add(items);
    expect(report.ok).toBe(true);
    expect(Number(sh(brain, "rev-list", "--count", "HEAD").trim()) - Number(before)).toBe(2);
    expect(sh(brain, "log", "-2", "--format=%s").trim().split("\n")).toEqual([
      "Add project Beta",
      "Add project Alpha",
    ]);
    expect(existsSync(join(brain, "Projects", "Alpha", "OpenItems.md"))).toBe(true);
    expect(readFileSync(join(brain, "Projects", "Alpha", "OpenItems.md"), "utf8")).toContain(
      "## Waiting on you",
    );
    const ws = loadWorkspaceFile(join(brain, "Office", "workspace.json"));
    expect(ws.ok && ws.workspace.projects.map((p) => [p.id, p.path, p.vault, p.group])).toEqual([
      ["alpha", "Alpha", "Projects/Alpha", "Games"],
      ["beta", "Beta", undefined, undefined],
    ]);
    expect(sh(brain, "status", "--porcelain").trim()).toBe("");
  });

  it("links notes that exist, removes a project from Office only, and handles the pointer", async () => {
    const { brain, projectsRoot, service } = await setup();
    mkdirSync(join(brain, "Projects", "Sheep"), { recursive: true });
    writeFileSync(join(brain, "Projects", "Sheep", "Overview.md"), "# Sheep\n");
    sh(brain, "add", "-A");
    sh(brain, "commit", "-q", "-m", "notes");
    const sheep = repo(join(projectsRoot, "Sheep"), { "AGENTS.md": "# Mine\n\nKeep this.\n" });
    const scan = await service.scan();
    expect(scan.find((c) => c.name === "Sheep")?.notes).toBe("Projects/Sheep");
    expect(service.unmatchedNotes()).toEqual(["Projects/Sheep"]);
    await service.add([
      { path: sheep, name: "Sheep", notes: "link", linkFolder: "Projects/Sheep", domain: "saas" },
    ]);
    expect(service.unmatchedNotes()).toEqual([]);

    // The pointer keeps the owner's text, commits only its file, and comes out byte for byte.
    const original = readFileSync(join(sheep, "AGENTS.md"), "utf8");
    const preview = service.pointerPreview("sheep");
    expect(preview.creates).toEqual([]);
    expect(preview.text).toContain("`Projects/Sheep`");
    const done = await service.pointerApply(["sheep"], false);
    expect(done.ok).toBe(true);
    expect(readFileSync(join(sheep, "AGENTS.md"), "utf8").startsWith(original)).toBe(true);
    expect(sh(sheep, "log", "-1", "--format=%s").trim()).toBe("Add the Office pointer");
    expect(sh(sheep, "show", "--stat", "--format=", "HEAD").trim()).toContain("AGENTS.md");
    await service.pointerRemove(["sheep"]);
    expect(readFileSync(join(sheep, "AGENTS.md"), "utf8")).toBe(original);
    expect(sh(sheep, "status", "--porcelain").trim()).toBe("");

    await service.remove("sheep");
    const ws = loadWorkspaceFile(join(brain, "Office", "workspace.json"));
    expect(ws.ok && ws.workspace.projects).toEqual([]);
    expect(existsSync(join(brain, "Projects", "Sheep", "Overview.md"))).toBe(true);
    expect(existsSync(sheep)).toBe(true);
  });

  it("creates AGENTS.md and CLAUDE.md only when neither exists, and removes what it made", async () => {
    const { projectsRoot, service } = await setup();
    const plain = repo(join(projectsRoot, "Plain"));
    await service.add([{ path: plain, name: "Plain", notes: "none", domain: "saas" }]);
    expect(service.pointerPreview("plain").creates).toEqual(["AGENTS.md", "CLAUDE.md"]);
    await service.pointerApply(["plain"], false);
    expect(readFileSync(join(plain, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    await service.pointerRemove(["plain"]);
    expect(existsSync(join(plain, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(plain, "CLAUDE.md"))).toBe(false);
  });
});
