import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/main/core/db";
import { Recorder } from "../../src/main/modules/vault/recorder";
import { replaceSection, sectionLines } from "../../src/main/modules/vault/sections";
import { parsePlan, recordingPrompt } from "../../src/main/modules/vault/recording-plan";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import type { SessionRow } from "../../src/shared/models";
import { Workspace } from "../../src/shared/schemas";
import { sh, tmp, write } from "../fixtures/repos/make";

let root: string;
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  root = tmp("office-recap-");
  db = openDb(join(root, "office.db"));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const workspace = Workspace.parse({
  version: 1, vault: { kind: "folder" }, projects: [{ id: "alpha", name: "Alpha", path: "Alpha", vault: "Projects/Alpha" }],
  roles: {}, pipelines: {}, notifications: { urgent: [] },
});
const message = (text: string) => JSON.stringify({ seq: 1, at: "2026-11-21T09:00:00Z", event: { t: "user", id: "m", text, images: 0 } }) + "\n";
const NL = String.fromCharCode(10);
const lines = (...parts: string[]): string => parts.join(NL);

describe("sections", () => {
  it("replaces one section's body and leaves the rest, or adds the section at the end", () => {
    const note = lines("---", "type: overview", "---", "", "# Alpha", "", "## Overview", "", "What it is.", "", "## Where it stands", "", "- old", "", "## Links", "", "- [[Other]]", "");
    const changed = replaceSection(note, "Where it stands", ["- new one", "- new two"]);
    expect(changed).toBe(lines("---", "type: overview", "---", "", "# Alpha", "", "## Overview", "", "What it is.", "", "## Where it stands", "", "- new one", "- new two", "", "## Links", "", "- [[Other]]", ""));
    expect(sectionLines(changed, "Where it stands")).toEqual(["", "- new one", "- new two", ""]);
    expect(sectionLines(changed, "Missing")).toBeNull();
    expect(replaceSection(lines("# Alpha", ""), "Where it stands", ["- first"])).toBe(lines("# Alpha", "", "## Where it stands", "", "- first", ""));
  });
});

describe("the recorder writes the recap in the same run", () => {
  it("parses the recap and state, asks for them only for a project session, and passes the previous recap along", () => {
    const plan = parsePlan(JSON.stringify({ entries: [], recap: { asked: "Do it — now", done: ["A"], unfinished: [], next: null }, state: ["Works"] }));
    expect(plan.recap).toEqual({ asked: "Do it , now", done: ["A"], unfinished: [], next: null });
    expect(plan.state).toEqual(["Works"]);
    expect(parsePlan('{"entries":[]}')).toEqual({ entries: [] });
    expect(recordingPrompt("text", false, true)).toContain('"recap"');
    expect(recordingPrompt("text", true, true)).not.toContain('"recap"');
    expect(recordingPrompt("text", false, true, "", false, { asked: "A", done: [], unfinished: [], next: "B" })).toContain("The session's recap so far");
  });

  it("keeps the session's recap, updates the project's Overview state, and does not repeat an unchanged state", async () => {
    const brain = join(root, "Brain");
    write(brain, "Projects/Alpha/Overview.md", lines("---", "type: overview", "summary: Alpha summary", "---", "", "# Alpha", "", "## Overview", "", "What Alpha is.", "", "## Where it stands", "", "- Old state line", "", "Updated 2026-11-01 by the Office recorder.", "", "## Links", "", "- [[Other]]", ""));
    sh(brain, "init", "-q", "-b", "main");
    sh(brain, "config", "user.email", "t@example.invalid");
    sh(brain, "config", "user.name", "T");
    sh(brain, "add", "-A");
    sh(brain, "commit", "-q", "-m", "Start the fixture");
    const writer = new VaultWriter({ hubRoot: () => null, onWarning: vi.fn(), today: () => "2026-11-21" });
    const answer = (extra: object) => JSON.stringify({
      entries: [],
      recap: { asked: "Add the checkout total.", done: ["Added the total in src/checkout.ts (commit 1a2b3c4)", "Recorded ADR-7"], unfinished: ["Tax is missing"], next: "Add tax in src/checkout.ts" },
      state: ["The checkout total works", "Tax is not done yet"], ...extra,
    });
    const complete = vi.fn<(session: SessionRow, prompt: string) => Promise<string>>()
      .mockResolvedValueOnce(answer({}))
      .mockResolvedValueOnce(answer({ recap: { asked: "Add the checkout total.", done: ["Added tax"], unfinished: [], next: null } }));
    const recorder = new Recorder({
      db, writer, workspace: () => workspace, root: () => brain, projectFolder: () => undefined, sessions: () => [],
      chatsDir: join(root, "chats"), terminalsDir: join(root, "terminals"),
      settings: () => ({ enabled: true, learning: false, idleMinutes: 10 }), complete, changed: vi.fn(),
    });
    const session = { id: "two", provider: "fake", projectId: "alpha", brainRoot: brain, cwd: join(root, "code"), incognito: false, role: null } as SessionRow;
    write(root, "chats/two/chat.jsonl", message("Add the checkout total"));
    await recorder.record(session);
    expect(complete.mock.calls[0]?.[1]).toContain('"recap"');
    expect(recorder.recapOf("two")).toMatchObject({
      asked: "Add the checkout total.", done: ["Added the total in src/checkout.ts (commit 1a2b3c4)", "Recorded ADR-7"],
      unfinished: ["Tax is missing"], next: "Add tax in src/checkout.ts",
    });
    expect(recorder.recapLines()).toEqual({ two: "Next: Add tax in src/checkout.ts" });
    const overview = readFileSync(join(brain, "Projects/Alpha/Overview.md"), "utf8");
    expect(overview).toContain(lines("## Where it stands", "", "- The checkout total works", "- Tax is not done yet", "", "Updated 2026-11-21 by the Office recorder.", "", "## Links"));
    expect(overview).not.toContain("Old state line");
    expect(overview).toContain("What Alpha is.");
    expect(overview).toContain("- [[Other]]");
    const commits = Number(sh(brain, "rev-list", "--count", "HEAD").trim());
    // The next run sees the recap so far, updates it, and leaves an unchanged state alone.
    appendFileSync(join(root, "chats/two/chat.jsonl"), message("Now add tax"));
    await recorder.record(session);
    expect(complete.mock.calls[1]?.[1]).toContain("Add tax in src/checkout.ts");
    expect(recorder.recapOf("two")).toMatchObject({ done: ["Added tax"], unfinished: [], next: null });
    expect(recorder.recapLines()).toEqual({ two: "Add the checkout total." });
    expect(Number(sh(brain, "rev-list", "--count", "HEAD").trim())).toBe(commits);
    expect(sh(brain, "status", "--porcelain").trim()).toBe("");
  });
});
