import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { openDb } from "../../src/main/core/db";
import { clearToolCache } from "../../src/main/core/exec";
import { Notifier } from "../../src/main/core/notifier";
import { WorkspaceStore } from "../../src/main/core/workspace";
import {
  addHubRow,
  addIgnoreLine,
  addRepoEntry,
  folderName,
  slugify,
} from "../../src/main/modules/explore/files";
import { ExploreService } from "../../src/main/modules/explore/explore";
import { splitSummary } from "../../src/main/modules/explore/spawn";
import { ProviderRegistry } from "../../src/main/modules/providers/registry";
import { RunService } from "../../src/main/modules/runs/service";
import { SessionService } from "../../src/main/modules/sessions/service";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import type { SpawnInput } from "../../src/shared/models";
import { sh } from "../fixtures/repos/make";
import { makeWorld } from "../fixtures/vault/make";

const fixtures = resolve(__dirname, "../fixtures");
const saved = { ...process.env };

describe("file helpers", () => {
  it("makes slugs and folder names", () => {
    expect(slugify("My Cool Game!")).toBe("my-cool-game");
    expect(slugify("Obras Rápidas")).toBe("obras-rapidas");
    expect(slugify("  ")).toBe("");
    expect(folderName("my cool game")).toBe("MyCoolGame");
  });

  it("edits the hub files without disturbing the rest", () => {
    expect(addIgnoreLine("A/\nB/\n", "C")).toBe("A/\nB/\nC/\n");
    expect(addIgnoreLine("A/\nB/", "C")).toBe("A/\nB/\nC/\n");
    expect(addIgnoreLine("A/\nC/\n", "C")).toBe("A/\nC/\n");
    const manifest =
      '{\n  "owner": "x",\n  "repos": [\n    { "folder": "A", "repo": "brain-a" }\n  ]\n}\n';
    const next = JSON.parse(addRepoEntry(manifest, "B", "brain-b"));
    expect(next.repos.map((r: { folder: string }) => r.folder)).toEqual(["A", "B"]);
    expect(addRepoEntry(addRepoEntry(manifest, "B", "brain-b"), "B", "brain-b")).toBe(
      addRepoEntry(manifest, "B", "brain-b"),
    );
    const index =
      "intro\n| Repo | x |\n|---|---|\n| `A/` | a |\n| `B/` | b |\n\n`Archive/` holds old.\n| `Z/` | late |\n";
    const out = addHubRow(index, "New", "A new one.", "saas");
    expect(out.split("\n")[5]).toBe("| `New/` | [[New/_index]] | A new one. | `saas` | Common |");
    expect(addHubRow(out, "New", "A new one.", "saas")).toBe(out);
    expect(() => addHubRow("no table", "X", "d", "saas")).toThrow(/no repo table/);
  });

  it("splits a summary into positioning and open items", () => {
    const parts = splitSummary(
      "Intro\n## Positioning and vision\n\nA game about sheep.\nFor everyone.\n\n## Open items\n- Pick a name\n* Draw the sheep\nnot a bullet\n",
    );
    expect(parts.positioning).toBe("A game about sheep.\nFor everyone.");
    expect(parts.items).toEqual(["Pick a name", "Draw the sheep"]);
    expect(splitSummary("Just text").positioning).toBe("Just text");
  });
});

function harness() {
  const world = makeWorld();
  const ghRemotes = join(world.root, "gh-remotes");
  mkdirSync(ghRemotes, { recursive: true });
  const gitConfig = join(world.root, "gitconfig-spawn");
  writeFileSync(
    gitConfig,
    [
      "[user]",
      "\tname = Office Test",
      "\temail = test@example.invalid",
      "[init]",
      "\tdefaultBranch = main",
      "[commit]",
      "\tgpgsign = false",
      '[protocol "file"]',
      "\tallow = always",
      `[url "${ghRemotes.replace(/\\/g, "/")}/"]`,
      "\tinsteadOf = git@github.com:fixture-owner/",
      "",
    ].join("\n"),
  );
  process.env["GIT_CONFIG_GLOBAL"] = gitConfig;
  process.env["FAKE_GH_REMOTES"] = ghRemotes;
  process.env["OFFICE_BIN_GH"] = join(fixtures, "bin/fake-gh.mjs");
  const home = mkdtempSync(join(tmpdir(), "office-spawn-home-"));
  cpSync(join(fixtures, "home"), home, { recursive: true });
  process.env["OFFICE_HOME"] = home;

  const db = openDb(":memory:");
  const bus = new Bus();
  const store = new WorkspaceStore();
  const providers = new ProviderRegistry();
  const notifier = new Notifier({
    db,
    bus,
    workspace: () => store.state.workspace,
    quietHours: () => undefined,
  });
  const sessions = new SessionService({
    db,
    bus,
    providers,
    notifier,
    workspace: () => store.state.workspace,
    projectPath: () => world.projectsRoot,
    logsDir: join(world.root, "logs"),
  });
  const runs = new RunService({ db, bus, providers, runsDir: join(world.root, "runs") });
  const writer = new VaultWriter({
    hubRoot: () => world.hub,
    onWarning: () => undefined,
    today: () => "2026-11-19",
  });
  const explore = new ExploreService({
    sessions,
    bus,
    exploreDir: join(world.root, "explore"),
    workspaceRoot: () => world.hub,
    spawn: {
      workspace: () => store.state.workspace,
      workspaceRoot: () => world.hub,
      projectsRoot: () => world.projectsRoot,
      workspaceFile: () => store.filePath,
      reloadWorkspace: () => store.reload(),
      writer,
      sessions,
      runs,
    },
  });
  return { world, store, explore, sessions, ghRemotes, db };
}

const input = (over: Partial<SpawnInput> = {}): SpawnInput => ({
  name: "Sheep Dream",
  visibility: "private",
  license: "none",
  stack: "a Node and React web app",
  domain: "saas",
  publicConfirmed: false,
  group: "Games",
  ...over,
});

beforeEach(() => {
  clearToolCache();
  process.env["OFFICE_BIN_FAKE_CLAUDE"] = join(fixtures, "bin/fake-claude.mjs");
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  clearToolCache();
});

describe("make this a project", () => {
  it("shows the checklist first, and a public repo needs its own confirmation", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    const steps = h.explore.plan(input({ visibility: "public", license: "mit" }));
    expect(steps.map((s) => s.id)).toEqual([
      "folder",
      "github",
      "brain-repo",
      "hub",
      "notes",
      "workspace",
      "session",
    ]);
    expect(steps[1]?.detail[0]).toContain("--public");
    expect(steps[0]?.detail.join(" ")).toContain("LICENSE (MIT)");
    await expect(h.explore.spawn(input({ visibility: "public", license: "mit" }))).rejects.toThrow(
      /own explicit confirmation/,
    );
    expect(existsSync(join(h.world.projectsRoot, "SheepDream"))).toBe(false);
    await h.store.close();
  });

  it("runs every step: repo, brain repo, hub registration, notes, workspace and session", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    const exploration = h.explore.start("fake", "Sheep ideas");
    for (let i = 0; i < 100 && !h.sessions.history(exploration.id).data.includes("ready"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const report = await h.explore.spawn(input({ exploreSessionId: exploration.id }));
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ["folder", "done"],
      ["github", "done"],
      ["brain-repo", "done"],
      ["hub", "done"],
      ["notes", "done"],
      ["workspace", "done"],
      ["session", "done"],
    ]);
    expect(report.ok).toBe(true);
    expect(report.projectId).toBe("sheep-dream");

    // The code folder: files, one commit, pushed to the fake GitHub as a private repo.
    const code = join(h.world.projectsRoot, "SheepDream");
    for (const f of ["README.md", ".gitattributes", ".gitignore", "AGENTS.md", "CLAUDE.md"])
      expect(existsSync(join(code, f))).toBe(true);
    expect(existsSync(join(code, "LICENSE"))).toBe(false);
    expect(readFileSync(join(code, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(readFileSync(join(code, "AGENTS.md"), "utf8")).not.toMatch(/[A-Z]:[\\/]/);
    expect(sh(code, "log", "--format=%s")).toContain("Start Sheep Dream");
    expect(sh(join(h.ghRemotes, "sheep-dream.git"), "log", "-1", "--format=%s").trim()).toBe(
      "Start Sheep Dream",
    );
    const log = readFileSync(join(h.ghRemotes, "gh.log"), "utf8");
    expect(log).toContain('"--private"');
    expect(log).toContain('"fixture-owner/brain-sheep-dream"');

    // The brain repo, over the SSH URL, and its registration in the hub.
    const brain = join(h.world.hub, "SheepDream");
    expect(sh(brain, "config", "--get", "remote.origin.url").trim()).toBe(
      "git@github.com:fixture-owner/brain-sheep-dream.git",
    );
    expect(readFileSync(join(brain, "Overview.md"), "utf8")).toContain("## Positioning and vision");
    expect(readFileSync(join(brain, "Overview.md"), "utf8")).toContain(
      "A fake exploration summary.",
    );
    const openItems = readFileSync(join(brain, "OpenItems.md"), "utf8");
    expect(openItems).toContain("## Waiting on you");
    expect(openItems).toContain("## Open items\n\n- Name the game\n- Draw the sheep");
    expect(JSON.parse(readFileSync(join(brain, "brain.json"), "utf8")).depends).toEqual([
      { folder: "Common", repo: "brain-common" },
    ]);
    expect(readFileSync(join(h.world.hub, ".gitignore"), "utf8")).toContain("SheepDream/");
    expect(readFileSync(join(h.world.hub, "brain.repos.json"), "utf8")).toContain(
      "brain-sheep-dream",
    );
    expect(readFileSync(join(h.world.hub, "_index.md"), "utf8")).toContain(
      "| `SheepDream/` | [[SheepDream/_index]]",
    );
    expect(sh(h.world.hub, "log", "-1", "--format=%s").trim()).toBe("Add Sheep Dream to the hub");
    expect(
      sh(h.world.hub, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort(),
    ).toEqual([".gitignore", "_index.md", "brain.repos.json"]);
    expect(sh(brain, "status", "--porcelain").trim()).toBe("");

    // The workspace config gained the project, and a session started in the new folder.
    expect(h.store.state.workspace?.projects.map((p) => p.id)).toContain("sheep-dream");
    expect(h.store.state.workspace?.projects.find((p) => p.id === "sheep-dream")).toMatchObject({
      name: "Sheep Dream",
      path: "SheepDream",
      vault: "SheepDream",
      group: "Games",
    });
    expect(sh(join(h.world.hub, "Office"), "log", "-1", "--format=%s").trim()).toBe(
      "Sheep Dream: add to the workspace",
    );
    const started = h.sessions.get(report.sessionId as string);
    expect(started).toMatchObject({ cwd: code, projectId: "sheep-dream" });
    h.sessions.shutdown();
    await h.store.close();
  });

  it("a public repo with a licence gets the MIT file and the --public flag", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    const report = await h.explore.spawn(
      input({
        name: "Open Thing",
        visibility: "public",
        license: "mit",
        publicConfirmed: true,
        group: undefined,
      }),
    );
    expect(report.ok).toBe(true);
    const code = join(h.world.projectsRoot, "OpenThing");
    expect(readFileSync(join(code, "LICENSE"), "utf8")).toContain("MIT License");
    expect(readFileSync(join(code, "LICENSE"), "utf8")).toContain("fixture-owner");
    expect(readFileSync(join(h.ghRemotes, "gh.log"), "utf8")).toContain('"--public"');
    h.sessions.shutdown();
    await h.store.close();
  });

  it("a failed step stops the wizard and reports what was and was not done", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    process.env["FAKE_GH_FAIL_CREATE"] = "brain-sheep-dream";
    const report = await h.explore.spawn(input());
    expect(report.ok).toBe(false);
    expect(report.failedAt).toBe("brain-repo");
    expect(report.steps.map((s) => s.status)).toEqual([
      "done",
      "done",
      "failed",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(report.steps[2]?.result).toContain("gh repo create failed");
    // Nothing pushed is rolled back, and the later steps never ran.
    expect(existsSync(join(h.ghRemotes, "sheep-dream.git"))).toBe(true);
    expect(h.store.state.workspace?.projects.map((p) => p.id)).not.toContain("sheep-dream");
    await h.store.close();
  });

  it("refuses a name whose brain folder exists before any GitHub repo is created", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    await expect(h.explore.spawn(input({ name: "Common" }))).rejects.toThrow(
      /already has a folder called Common/,
    );
    expect(existsSync(join(h.ghRemotes, "common.git"))).toBe(false);
    expect(existsSync(join(h.ghRemotes, "gh.log"))).toBe(false);
    expect(existsSync(join(h.world.projectsRoot, "Common"))).toBe(false);
    await h.store.close();
  });

  it("leaves the hub files as they were when the registration fails", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    writeFileSync(join(h.world.hub, "FAIL_VALIDATE"), "");
    const before = ["_index.md", ".gitignore", "brain.repos.json"].map((f) =>
      readFileSync(join(h.world.hub, f), "utf8"),
    );
    const report = await h.explore.spawn(input());
    expect(report.failedAt).toBe("hub");
    expect(report.steps[3]?.result).toContain("brain validate failed");
    expect(
      ["_index.md", ".gitignore", "brain.repos.json"].map((f) =>
        readFileSync(join(h.world.hub, f), "utf8"),
      ),
    ).toEqual(before);
    expect(
      sh(h.world.hub, "status", "--porcelain", "--", "_index.md", "brain.repos.json").trim(),
    ).toBe("");
    await h.store.close();
  });

  it("refuses to register when a hub file has changes that are not committed", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    const index = join(h.world.hub, "_index.md");
    const mine = `${readFileSync(index, "utf8")}\nmy own note\n`;
    writeFileSync(index, mine);
    const report = await h.explore.spawn(input());
    expect(report.failedAt).toBe("hub");
    expect(report.steps[3]?.result).toContain("not committed");
    expect(readFileSync(index, "utf8")).toBe(mine);
    await h.store.close();
  });

  it("pulls the hub first, so another machine's change is kept and the push works", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    const other = join(h.world.root, "hub-other");
    sh(h.world.root, "clone", "-q", h.world.remotes["."] as string, other);
    writeFileSync(join(other, "Other.md"), "from another machine\n");
    sh(other, "add", "Other.md");
    sh(other, "commit", "-q", "-m", "other machine");
    sh(other, "push", "-q");
    const report = await h.explore.spawn(input());
    expect(report.ok).toBe(true);
    expect(readFileSync(join(h.world.hub, "Other.md"), "utf8")).toBe("from another machine\n");
    expect(report.steps[3]?.result).toBe("registered");
    expect(sh(h.world.remotes["."] as string, "log", "-1", "--format=%s").trim()).toBe(
      "Add Sheep Dream to the hub",
    );
    h.sessions.shutdown();
    await h.store.close();
  });

  it("reports a failed hub push instead of ignoring it", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    sh(h.world.hub, "remote", "set-url", "--push", "origin", join(h.world.root, "nowhere.git"));
    const report = await h.explore.spawn(input());
    expect(report.ok).toBe(true);
    expect(report.steps[3]?.result).toMatch(/not pushed: the hub/);
    expect(sh(h.world.hub, "log", "-1", "--format=%s").trim()).toBe("Add Sheep Dream to the hub");
    h.sessions.shutdown();
    await h.store.close();
  });

  it("refuses an existing project id, a non-empty folder and an empty name", async () => {
    const h = harness();
    await h.store.open(h.world.hub, h.world.workspaceConfigPath);
    await expect(h.explore.spawn(input({ name: "Alpha" }))).rejects.toThrow(/already exists/);
    mkdirSync(join(h.world.projectsRoot, "Taken"));
    writeFileSync(join(h.world.projectsRoot, "Taken", "x.txt"), "x");
    await expect(h.explore.spawn(input({ name: "Taken" }))).rejects.toThrow(/already has files/);
    await expect(h.explore.spawn(input({ name: "!!!" }))).rejects.toThrow(/letters or digits/);
    await h.store.close();
  });
});
