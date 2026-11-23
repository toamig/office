import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createBrain } from "../../src/main/modules/onboarding/brain";
import { folderRouterEdits, replaceGenerated, validateFolderBrain } from "../../src/main/modules/vault/folder-brain";
import {
  defaultTarget,
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

const block = pointerBlock({
  name: "Alpha",
  notesPath: "C:/Notes/Brain/Projects/Alpha",
  notesFolder: "Projects/Alpha",
  remote: null,
});

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

  it("gives the absolute folder of the notes and the brain's remote when there is one", () => {
    expect(block).toContain("`C:/Notes/Brain/Projects/Alpha`");
    expect(block).toContain("`Projects/Alpha`");
    expect(block).not.toContain("git remote");
    const withRemote = pointerBlock({
      name: "Alpha",
      notesPath: "C:/Notes/Brain/Projects/Alpha",
      notesFolder: "Projects/Alpha",
      remote: "git@github.com:me/brain.git",
    });
    expect(withRemote).toContain("`git@github.com:me/brain.git`");
  });

  it("goes in the local file for a public repo and in AGENTS.md otherwise, or when GitHub cannot say", () => {
    expect(defaultTarget("PUBLIC")).toBe("local");
    expect(defaultTarget("public")).toBe("local");
    expect(defaultTarget("PRIVATE")).toBe("agents");
    expect(defaultTarget("INTERNAL")).toBe("agents");
    expect(defaultTarget(null)).toBe("agents");
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
        "_index.md",
        "Shared/OwnerProfile.md",
        "General/Journal.md",
      ]),
    );
    expect(sh(dir, "log", "--format=%s").trim()).toBe("Start the brain");
    expect(sh(dir, "status", "--porcelain").trim()).toBe("");
    const loaded = loadWorkspaceFile(join(dir, "Office", "workspace.json"));
    expect(loaded.ok && loaded.workspace.projects).toEqual([]);
    expect(loaded.ok && loaded.workspace.vault.kind).toBe("folder");
    // Since M16.2 the root AGENTS.md only points at the shipped rules; the rules themselves carry the convention.
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("Rules/AGENTS.md");
    expect(readFileSync(join(dir, "Rules", "Authoring.md"), "utf8")).toContain("Waiting on you");
    expect(validateFolderBrain(dir, []).ok).toBe(true);
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
    for (const name of ["Decisions", "Architecture", "Contracts", "Design", "Audience", "References", "Journal", "Lessons"])
      expect(existsSync(join(brain, "Projects", "Alpha", `${name}.md`))).toBe(true);
    expect(readFileSync(join(brain, "_index.md"), "utf8")).toContain("[[Projects/Alpha/_index]]");
    expect(readFileSync(join(brain, "Projects", "Alpha", "_index.md"), "utf8")).toContain("[[Projects/Alpha/Contracts]]");
    expect(validateFolderBrain(brain, []).ok).toBe(true);
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

  it("regenerates only router content and checks link targets and headings", async () => {
    const { brain } = await setup();
    const router = join(brain, "_index.md");
    writeFileSync(router, readFileSync(router, "utf8").replace("# Brain", "# My Brain\n\nMy note."));
    const journal = join(brain, "General", "Journal.md");
    writeFileSync(journal, readFileSync(journal, "utf8") + "\n[[General/References#Missing]]\n");
    const index = folderRouterEdits(brain, []).find((item) => item.path === "_index.md")!;
    expect(replaceGenerated(index.before, index.generated)).toContain("# My Brain\n\nMy note.");
    expect(validateFolderBrain(brain, []).errors).toContain("General/Journal.md: Missing heading [[General/References.md#Missing]]");
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
    const preview = await service.pointerPreview("sheep");
    expect(preview.creates.agents).toEqual([]);
    expect(preview.text).toContain("`Projects/Sheep`");
    // The path in the text is one an agent can open on this PC.
    const named = /in `([^`]+)` \(the folder/.exec(preview.text)?.[1] ?? "";
    expect(named).toBe(join(brain, "Projects", "Sheep").replaceAll("\\", "/"));
    expect(existsSync(join(named, "Overview.md"))).toBe(true);
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
    expect((await service.pointerPreview("plain")).creates.agents).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    await service.pointerApply(["plain"], false);
    expect(readFileSync(join(plain, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    await service.pointerRemove(["plain"]);
    expect(existsSync(join(plain, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(plain, "CLAUDE.md"))).toBe(false);
  });

  describe("where the pointer goes", () => {
    const withGh = async <T>(visibility: string, body: () => Promise<T>): Promise<T> => {
      const before = process.env["OFFICE_BIN_GH"];
      const vis = process.env["FAKE_GH_VISIBILITY"];
      process.env["OFFICE_BIN_GH"] = resolve(__dirname, "../fixtures/bin/fake-gh.mjs");
      process.env["FAKE_GH_REMOTES"] = tmp("office-fake-gh-");
      process.env["FAKE_GH_VISIBILITY"] = visibility;
      try {
        return await body();
      } finally {
        if (before === undefined) delete process.env["OFFICE_BIN_GH"];
        else process.env["OFFICE_BIN_GH"] = before;
        if (vis === undefined) delete process.env["FAKE_GH_VISIBILITY"];
        else process.env["FAKE_GH_VISIBILITY"] = vis;
      }
    };

    it("defaults to the local file for a public repo: written, never committed, kept out of git, and removed byte for byte", async () => {
      const { projectsRoot, service } = await setup();
      const original = "# Mine\n\nKeep this.\n";
      const pub = repo(join(projectsRoot, "Pub"), { "CLAUDE.local.md": original });
      // The owner's own local file is not tracked: the file exists but git ignores it.
      sh(pub, "rm", "-q", "--cached", "CLAUDE.local.md");
      sh(pub, "commit", "-q", "-m", "untrack");
      await service.add([{ path: pub, name: "Pub", notes: "none", domain: "saas" }]);
      await withGh("*=PUBLIC", async () => {
        const preview = await service.pointerPreview("pub");
        expect(preview.visibility).toBe("PUBLIC");
        expect(preview.target).toBe("local");
        expect(preview.file).toBe(join(pub, "CLAUDE.local.md"));
        const before = sh(pub, "rev-parse", "HEAD").trim();
        const done = await service.pointerApply(["pub"], false);
        expect(done.ok).toBe(true);
        expect(sh(pub, "rev-parse", "HEAD").trim()).toBe(before);
        expect(existsSync(join(pub, "AGENTS.md"))).toBe(false);
        const written = readFileSync(join(pub, "CLAUDE.local.md"), "utf8");
        expect(written.startsWith(original)).toBe(true);
        expect(written).toContain(preview.text.split("\n")[1] ?? "");
        expect(sh(pub, "status", "--porcelain").trim()).toBe("");
        expect(readFileSync(join(pub, ".git", "info", "exclude"), "utf8")).toContain(
          "CLAUDE.local.md",
        );
        // Applying twice changes nothing, and the exclude line is not repeated.
        await service.pointerApply(["pub"], false);
        expect(
          readFileSync(join(pub, ".git", "info", "exclude"), "utf8")
            .split(/\r?\n/)
            .filter((l) => l === "CLAUDE.local.md"),
        ).toHaveLength(1);
        await service.pointerRemove(["pub"]);
        expect(readFileSync(join(pub, "CLAUDE.local.md"), "utf8")).toBe(original);
      });
    });

    it("defaults to AGENTS.md for a private repo, and for a repo when gh fails", async () => {
      const { projectsRoot, service } = await setup();
      const priv = repo(join(projectsRoot, "Priv"));
      const broken = repo(join(projectsRoot, "Broken"));
      await service.add([
        { path: priv, name: "Priv", notes: "none", domain: "saas" },
        { path: broken, name: "Broken", notes: "none", domain: "saas" },
      ]);
      await withGh("Priv=PRIVATE,Broken=fail", async () => {
        const a = await service.pointerPreview("priv");
        expect([a.visibility, a.target, a.file]).toEqual([
          "PRIVATE",
          "agents",
          join(priv, "AGENTS.md"),
        ]);
        const b = await service.pointerPreview("broken");
        expect([b.visibility, b.target, b.file]).toEqual([
          null,
          "agents",
          join(broken, "AGENTS.md"),
        ]);
        await service.pointerApply(["priv", "broken"], false);
        expect(existsSync(join(priv, "AGENTS.md"))).toBe(true);
        expect(existsSync(join(broken, "AGENTS.md"))).toBe(true);
        expect(existsSync(join(priv, "CLAUDE.local.md"))).toBe(false);
      });
    });

    it("follows the owner's choice over the default, in either direction", async () => {
      const { projectsRoot, service } = await setup();
      const a = repo(join(projectsRoot, "Aaa"));
      const b = repo(join(projectsRoot, "Bbb"));
      await service.add([
        { path: a, name: "Aaa", notes: "none", domain: "saas" },
        { path: b, name: "Bbb", notes: "none", domain: "saas" },
      ]);
      await withGh("Aaa=PUBLIC,Bbb=PRIVATE", async () => {
        await service.pointerApply(["aaa"], false, "agents");
        await service.pointerApply(["bbb"], false, "local");
        expect(existsSync(join(a, "AGENTS.md"))).toBe(true);
        expect(existsSync(join(a, "CLAUDE.local.md"))).toBe(false);
        expect(existsSync(join(b, "AGENTS.md"))).toBe(false);
        expect(existsSync(join(b, "CLAUDE.local.md"))).toBe(true);
        // Remove finds the block in whichever file holds it.
        await service.pointerRemove(["aaa", "bbb"]);
        expect(existsSync(join(a, "AGENTS.md"))).toBe(false);
        expect(existsSync(join(b, "CLAUDE.local.md"))).toBe(false);
      });
    });

    it("adds the brain's remote to the text when the brain has one", async () => {
      const { brain, projectsRoot, service } = await setup();
      sh(brain, "remote", "add", "origin", "https://example.com/me/brain.git");
      const c = repo(join(projectsRoot, "Ccc"));
      await service.add([{ path: c, name: "Ccc", notes: "none", domain: "saas" }]);
      await withGh("*=PRIVATE", async () => {
        const preview = await service.pointerPreview("ccc");
        expect(preview.text).toContain("`https://example.com/me/brain.git`");
      });
    });
  });
});
