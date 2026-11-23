import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_RANGE_LABELS, briefSince, concreteLine, type BriefCard, type BriefLink } from "../../src/shared/brief";
import { openDb } from "../../src/main/core/db";
import type { Notifier } from "../../src/main/core/notifier";
import { BriefService, buildBriefPrompt, factIndex, parseBrief, plainCard } from "../../src/main/modules/brief/brief";
import type { RunRequest, RunService } from "../../src/main/modules/runs/service";
import { Workspace } from "../../src/shared/schemas";
import { commit, sh, tmp, write } from "../fixtures/repos/make";

const NOW = new Date(2026, 10, 23, 10, 0); // Monday
let root: string;
let db: ReturnType<typeof openDb>;
const saved = { ...process.env };
beforeEach(() => { root = tmp("office-brief-"); db = openDb(join(root, "office.db")); });
afterEach(() => {
  db.close();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  rmSync(root, { recursive: true, force: true });
});

function at(date: string, run: () => string): string {
  process.env["GIT_AUTHOR_DATE"] = date;
  process.env["GIT_COMMITTER_DATE"] = date;
  try { return run(); } finally { delete process.env["GIT_AUTHOR_DATE"]; delete process.env["GIT_COMMITTER_DATE"]; }
}

/** A fixture week: Thursday and Friday of work, a weekend of nothing, and now is Monday morning. */
function week() {
  const code = join(root, "Code");
  const hub = join(root, "Brain");
  sh(root, "init", "-q", "Code");
  sh(root, "init", "-q", "Brain");
  sh(code, "config", "user.email", "t@example.invalid"); sh(code, "config", "user.name", "T");
  sh(hub, "config", "user.email", "t@example.invalid"); sh(hub, "config", "user.name", "T");
  const old = at("2026-11-19T10:00:00", () => commit(code, "old.txt", "x", "An old change on Thursday"));
  const first = at("2026-11-20T09:30:00", () => { write(code, "src/checkout.ts", "a"); write(code, "src/cart.ts", "b"); sh(code, "add", "-A"); sh(code, "commit", "-q", "-m", "Add the checkout total to the cart"); return sh(code, "rev-parse", "HEAD").trim(); });
  const second = at("2026-11-20T15:00:00", () => commit(code, "docs/checkout.md", "doc", "Document the checkout total"));
  at("2026-11-20T16:00:00", () => {
    write(hub, "Projects/Alpha/Decisions.md", "---\ntype: decisions\n---\n\n# Decisions\n\n## ADR-7: Totals are computed on the server\n");
    write(hub, "Projects/Alpha/OpenItems.md", "---\ntype: openitems\n---\n\n# Open items\n\n## Waiting on you\n\n- [ ] 2026-11-20 Approve the new checkout copy (Office recorder)\n\n## Open items\n\n- [ ] Add tax to the checkout total\n- [x] Fix the cart icon\n");
    sh(hub, "add", "-A"); sh(hub, "commit", "-q", "-m", "Alpha: record ADR-7 and the open items");
    return "";
  });
  const sessionRow = db.prepare("INSERT INTO sessions (id, provider, project_id, cwd, title, status, interactive, created_at, updated_at, mode) VALUES (?, 'claude-code', 'alpha', ?, ?, 'idle', 0, ?, ?, 'chat')");
  sessionRow.run("s-friday", code, "Checkout total", "2026-11-20T09:00:00", "2026-11-20T15:30:00");
  sessionRow.run("s-norecap", code, "Look at the cart icon", "2026-11-20T14:00:00", "2026-11-20T14:30:00");
  db.prepare("INSERT INTO session_recaps (session_id, project_id, at, asked, done, unfinished, next_step) VALUES (?, 'alpha', ?, ?, ?, ?, ?)")
    .run("s-friday", "2026-11-20T15:31:00", "Add the checkout total to the cart.",
      JSON.stringify(["Added the total to src/checkout.ts and src/cart.ts in one commit", "Recorded ADR-7: totals are computed on the server"]),
      JSON.stringify(["Tax is not included in the total yet"]), "Add tax to the checkout total in src/checkout.ts");
  const workspace = Workspace.parse({
    version: 1, vault: { kind: "folder" }, projects: [{ id: "alpha", name: "Alpha", path: "Code", vault: "Projects/Alpha" }],
    roles: {}, pipelines: {}, notifications: { urgent: [] },
  });
  return { code, hub, workspace, old, first, second };
}

function service(workspace: ReturnType<typeof Workspace.parse>, runs: Partial<RunService> = {}, enabled = false) {
  const brief = new BriefService({
    db, runs: runs as RunService, notifier: {} as Notifier, workspace: () => workspace, projectsRoot: () => root, workspaceRoot: () => join(root, "Brain"),
    now: () => NOW, settings: () => ({ enabled, model: "" }),
  });
  brief.needsYou = () => [
    { text: "Approve the checkout copy", link: { view: "inbox" } }, { text: "Review request", link: { view: "inbox" } },
    { text: "CI failed", link: { view: "git", params: { project: "alpha" } } }, { text: "A fourth thing", link: { view: "inbox" } },
  ];
  return brief;
}

describe("where the brief starts", () => {
  it("a Monday covers Friday, a week away covers the week, and the other ranges start where they say", () => {
    expect(briefSince("since-last", NOW, ["2026-11-19", "2026-11-20", "2026-11-23"])).toEqual(new Date(2026, 10, 20));
    expect(briefSince("since-last", NOW, ["2026-11-16"])).toEqual(new Date(2026, 10, 16));
    expect(briefSince("since-last", NOW, [])).toEqual(new Date(2026, 10, 22));
    expect(briefSince("three-days", NOW, [])).toEqual(new Date(2026, 10, 21));
    expect(briefSince("this-week", new Date(2026, 10, 25, 9, 0), [])).toEqual(new Date(2026, 10, 23));
    expect(Object.values(BRIEF_RANGE_LABELS)).toEqual(["Since last time", "Last 3 days", "This week"]);
  });

  it("finds Friday from the sessions, recaps and commits of the fixture week", async () => {
    const { workspace } = week();
    expect(await service(workspace).since("since-last")).toEqual(new Date(2026, 10, 20));
  });
});

describe("the facts of a fixture week", () => {
  it("include each session's recap, commits with their files, changed notes and open items, and leave out Thursday", async () => {
    const { workspace, old } = week();
    const brief = service(workspace);
    const [facts] = await brief.collect(await brief.since("since-last"));
    expect(facts?.project.id).toBe("alpha");
    expect(facts?.sessions.map((session) => [session.id, session.recap?.next ?? null])).toEqual(expect.arrayContaining([
      ["s-friday", "Add tax to the checkout total in src/checkout.ts"], ["s-norecap", null],
    ]));
    expect(facts?.commits.map((entry) => entry.subject)).toEqual(["Document the checkout total", "Add the checkout total to the cart"]);
    expect(facts?.commits.some((entry) => entry.sha === old)).toBe(false);
    expect(facts?.commits.find((entry) => entry.subject.startsWith("Add the checkout"))?.files.sort()).toEqual(["src/cart.ts", "src/checkout.ts"]);
    expect(facts?.notes.map((note) => note.name).sort()).toEqual(["Decisions", "OpenItems"]);
    expect(facts?.open.map((item) => [item.waiting, item.text])).toEqual([[true, "Approve the new checkout copy"], [false, "Add tax to the checkout total"]]);
    const prompt = buildBriefPrompt(facts ? [facts] : [], "Friday");
    expect(prompt).toContain("Add tax to the checkout total in src/checkout.ts");
    expect(prompt).toContain("files: src/cart.ts, src/checkout.ts");
    expect(prompt).toContain("Brain note Decisions changed");
    expect(prompt).toContain("Waiting on you: Approve the new checkout copy");
  });
});

/** Whether a link points at something that exists in the fixture. */
function resolves(link: BriefLink, env: { code: string; hub: string }): boolean {
  const params = link.params ?? {};
  if (link.view === "agents") return Boolean(db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(params["session"]));
  if (link.view === "git") {
    if (!params["commit"]) return params["project"] === "alpha";
    try { sh(env.code, "cat-file", "-e", `${params["commit"]}^{commit}`); return true; } catch { return false; }
  }
  if (link.view === "project") {
    const file = join(env.hub, "Projects", "Alpha", `${params["note"]}.md`);
    if (params["tab"] !== "notes" || !existsSync(file)) return false;
    return !params["section"] || readFileSync(file, "utf8").includes(`## ${params["section"]}`);
  }
  return false;
}

describe("the brief written from the facts", () => {
  it("every line names a concrete thing and its link resolves to its session, commit or note", async () => {
    const env = week();
    const brief = service(env.workspace);
    await brief.run();
    const view = brief.latest();
    expect(view.range).toBe("since-last");
    expect(new Date(view.since ?? "")).toEqual(new Date(2026, 10, 20));
    const [card] = view.cards;
    expect(card?.projectName).toBe("Alpha");
    expect(card?.done.map((line) => line.text)).toEqual(expect.arrayContaining([
      expect.stringContaining("Added the total to src/checkout.ts and src/cart.ts"),
      expect.stringContaining("Add the checkout total to the cart (src/cart.ts, src/checkout.ts)"),
      expect.stringContaining("Updated the Decisions note"),
    ]));
    expect(card?.stands.map((line) => line.text)).toEqual(expect.arrayContaining([
      expect.stringContaining("Tax is not included in the total yet"), expect.stringContaining("Waiting on you: Approve the new checkout copy"),
    ]));
    expect(card?.next.map((next) => next.action.kind)).toEqual(["continue", "open"]);
    expect(card?.next[0]?.action).toEqual({ kind: "continue", sessionId: "s-friday" });
    const lines = [...(card?.done ?? []), ...(card?.stands ?? [])];
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      expect(concreteLine(line.text), line.text).toBe(true);
      expect(resolves(line.link, env), `${line.text} -> ${JSON.stringify(line.link)}`).toBe(true);
    }
    for (const next of card?.next ?? []) if (next.action.kind === "open") expect(resolves(next.action.link, env)).toBe(true);
    // The session without a recap is said, not hidden.
    expect(card?.unknown).toMatch(/1 session has no recap/);
    // At most three things that need you, across projects.
    expect(view.needsYou.map((item) => item.text)).toEqual(["Approve the checkout copy", "Review request", "CI failed"]);
  });

  it("says what it does not know when the facts are thin, and a project with no news has no card", async () => {
    const env = week();
    db.prepare("DELETE FROM session_recaps").run();
    const brief = service(env.workspace);
    const facts = await brief.collect(new Date(2026, 10, 22));
    expect(facts).toEqual([]);
    await brief.run("this-week");
    expect(brief.latest().cards).toEqual([]);
  });

  it("catches up one project, by default since it was last worked on", async () => {
    const env = week();
    const brief = service(env.workspace);
    const { since, card } = await brief.catchUp("alpha");
    expect(new Date(since)).toEqual(new Date(2026, 10, 20));
    expect(card.projectId).toBe("alpha");
    expect(card.done.length).toBeGreaterThan(0);
    await expect(brief.catchUp("nope")).rejects.toThrow(/not in this workspace/);
  });
});

describe("the brief written by a model", () => {
  it("is asked for Sonnet with read tools, keeps only lines that cite a fact and say something, and links each to its fact", async () => {
    const env = week();
    let request: RunRequest | undefined;
    const runs = {
      start: vi.fn((made: RunRequest) => {
        request = made;
        const facts = made.prompt;
        const session = /- (S\d+): Session "Checkout total"/.exec(facts)?.[1] ?? "S1";
        const commitId = /- (C\d+): Commit \w+: Add the checkout total/.exec(facts)?.[1] ?? "C1";
        const note = /- (N\d+): Brain note Decisions/.exec(facts)?.[1] ?? "N1";
        const reply = { projects: [
          { projectId: "alpha", done: [
            { text: "Added the checkout total to src/checkout.ts and src/cart.ts", ref: commitId },
            { text: "Recorded ADR-7, totals are computed on the server", ref: note },
            { text: "Made progress on the cart", ref: commitId },
            { text: "Fixed a bug nobody can find in the facts", ref: "C99" },
            { text: "Moved the cart icon to the right place", ref: "g1" },
          ], stands: [{ text: "Tax is not in the total yet", ref: session }], next: [
            { text: "Add tax to the checkout total", ref: session, action: "continue" },
            { text: "Open the note for me", ref: commitId, action: "open" },
            { text: "Start on adding tax to the total", ref: session, action: "start" },
          ], unknown: "I do not know if the checkout copy was approved." },
          { projectId: "ghost", done: [{ text: "Something that is not a project here", ref: "C1" }], stands: [], next: [] },
        ] };
        return { id: "run", dir: root, result: Promise.resolve({ ok: true, resultText: `Here you go:\n${JSON.stringify(reply)}`, id: "run" }) };
      }),
    };
    const brief = service(env.workspace, runs as unknown as RunService, true);
    await brief.run();
    expect(request?.role?.model).toBe("sonnet");
    expect(request?.tools).toBe("Read,Grep,Glob");
    expect(request?.brain?.writable).toEqual([]);
    const [card] = brief.latest().cards;
    expect(card?.done.map((line) => line.text)).toEqual([
      "Added the checkout total to src/checkout.ts and src/cart.ts", "Recorded ADR-7, totals are computed on the server",
    ]);
    for (const line of card?.done ?? []) expect(resolves(line.link, env)).toBe(true);
    expect(card?.done[0]?.link.view).toBe("git");
    expect(card?.done[1]?.link).toEqual({ view: "project", params: { id: "alpha", tab: "notes", note: "Decisions" } });
    expect(card?.next.map((next) => next.action.kind)).toEqual(["continue", "start"]);
    expect(card?.next[0]?.action).toEqual({ kind: "continue", sessionId: "s-friday" });
    expect(card?.unknown).toBe("I do not know if the checkout copy was approved.");
    expect(brief.latest().cards).toHaveLength(1);
  });

  it("falls back to the lines written from the facts when the reply is not usable", async () => {
    const env = week();
    const runs = { start: () => ({ id: "r", dir: root, result: Promise.resolve({ ok: true, resultText: "I cannot do that.", id: "r" }) }) };
    const brief = service(env.workspace, runs as unknown as RunService, true);
    await brief.run();
    const [card] = brief.latest().cards;
    expect(card?.done.length).toBeGreaterThan(2);
    expect(parseBriefSafe("nonsense")).toBe("threw");
  });

  it("cards from the facts match what parseBrief and plainCard produce for a project with only commits", async () => {
    const env = week();
    const brief = service(env.workspace);
    const [facts] = await brief.collect(new Date(2026, 10, 20));
    const plain: BriefCard = plainCard({ ...facts!, sessions: [], notes: [], open: [], stands: [] });
    expect(plain.done.map((line) => line.link.view)).toEqual(["git", "git"]);
    expect(plain.next).toEqual([]);
    expect(plain.unknown).toBeNull();
    expect(factIndex(facts!).filter((fact) => fact.kind === "S")).toHaveLength(2);
    expect(parseBrief('{"projects":[]}', [facts!])).toEqual([]);
  });
});

function parseBriefSafe(text: string): string {
  try { parseBrief(text, []); return "ok"; } catch { return "threw"; }
}
