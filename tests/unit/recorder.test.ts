import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/main/core/db";
import { Recorder } from "../../src/main/modules/vault/recorder";
import { formatWaitingLine, parseOpenItems, REMINDER_SOURCE, waitingIsDue } from "../../src/main/modules/vault/openitems";
import { reminderDate } from "../../src/main/modules/ask/router";
import { recordTarget } from "../../src/main/modules/vault/recording-plan";
import { brainScope, notesPath } from "../../src/main/modules/vault/scope";
import { VaultWriter } from "../../src/main/modules/vault/writer";
import type { SessionRow } from "../../src/shared/models";
import { Workspace } from "../../src/shared/schemas";
import { commit, sh, tmp, write } from "../fixtures/repos/make";

let root: string;
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  root = tmp("office-recorder-");
  db = openDb(join(root, "office.db"));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const workspace = Workspace.parse({
  version: 1, vault: { kind: "folder" },
  projects: [
    { id: "alpha", name: "Alpha", path: "Alpha", vault: "Projects/Alpha" },
    { id: "beta", name: "Beta", path: "Beta", vault: "Projects/Beta" },
  ],
  roles: {}, pipelines: {}, notifications: { urgent: [] },
});
const now = "2026-11-21T09:00:00Z";

const message = (text: string) => JSON.stringify({
  seq: 1, at: now, event: { t: "user", id: "m", text, images: 0 },
}) + "\n";

describe("brain recorder", () => {
  it("validates reminder dates and holds scheduled items until the due day", () => {
    expect(() => reminderDate("2026-02-29")).toThrow(/invalid/);
    const date = reminderDate("2026-11-22");
    const line = formatWaitingLine(date, "Review the draft", REMINDER_SOURCE);
    const item = parseOpenItems(`## Waiting on you\n\n${line}\n`).waiting[0]!;
    expect(waitingIsDue(item, new Date(2026, 10, 21, 23, 59))).toBe(false);
    expect(waitingIsDue(item, new Date(2026, 10, 22))).toBe(true);
  });

  it("routes only to the project's notes, keeps private notes out of other context, and rejects traversal", () => {
    write(root, "Projects/Alpha/Overview.md", "---\nsummary: Alpha summary\n---\nAlpha");
    write(root, "Projects/Beta/brain.json", '{"private":true}');
    write(root, "Projects/Beta/Overview.md", "Beta private content");
    const alpha = brainScope(workspace, root, "alpha");
    expect(alpha?.writable).toEqual([join(root, "Projects/Alpha")]);
    expect(alpha?.private).toContain(join(root, "Projects/Beta"));
    expect(alpha?.instructions).toContain("Alpha summary");
    expect(alpha?.instructions).not.toContain("Beta private content");
    expect(notesPath(root, "Projects/Alpha/../../../../outside")).toBeNull();
    expect(recordTarget(workspace, root, "alpha", "decision")?.path).toBe("Projects/Alpha/Decisions.md");
    expect(recordTarget(workspace, root, "beta", "profile")).toBeNull();
    expect(recordTarget(workspace, root, null, "lesson")).toBeNull();
    expect(recordTarget(workspace, root, null, "journal")?.path).toBe("General/Journal.md");
  });

  it("files once per file, reads only new messages, skips incognito, and undoes by commit", async () => {
    const brain = join(root, "Brain");
    write(brain, "Projects/Alpha/Overview.md", "# Alpha\n");
    sh(brain, "init", "-q", "-b", "main");
    commit(brain, "Projects/Alpha/Overview.md", "# Alpha\n", "Start the fixture");
    const writer = new VaultWriter({ hubRoot: () => null, onWarning: vi.fn(), today: () => "2026-11-21" });
    const complete = vi.fn<(session: SessionRow, prompt: string) => Promise<string>>()
      .mockResolvedValueOnce(JSON.stringify({ entries: [
        { destination: "todo", text: "Run the check", certainty: "save" },
        { destination: "waiting", text: "Choose a label", certainty: "save" },
        { destination: "decision", text: "Consider teal", certainty: "ask" },
      ] }))
      .mockResolvedValueOnce('{"entries":[]}');
    const recorder = new Recorder({
      db, writer, workspace: () => workspace, root: () => brain,
      projectFolder: () => undefined, sessions: () => [],
      chatsDir: join(root, "chats"), terminalsDir: join(root, "terminals"),
      settings: () => ({ enabled: true, learning: true, idleMinutes: 10 }),
      complete, changed: vi.fn(),
    });
    const session = {
      id: "one", provider: "fake", projectId: "alpha", brainRoot: brain,
      cwd: join(root, "code"), incognito: false, role: null,
    } as SessionRow;
    const log = join(root, "chats/one/chat.jsonl");
    write(root, "chats/one/chat.jsonl", message("Only the first message"));
    expect(await recorder.record({ ...session, incognito: true })).toEqual({ saved: 0, proposed: 0 });
    expect(complete).not.toHaveBeenCalled();
    expect(await recorder.record(session)).toEqual({ saved: 1, proposed: 1 });
    expect(readFileSync(join(brain, "Projects/Alpha/OpenItems.md"), "utf8")).toContain("- [ ] 2026-11-21 Choose a label");
    expect(recorder.pending()).toMatchObject([{ detail: "Consider teal" }]);
    expect(sh(brain, "rev-list", "--count", "HEAD").trim()).toBe("2");
    expect(await recorder.record(session)).toEqual({ saved: 0, proposed: 0 });
    appendFileSync(log, message("Only the new message"));
    await recorder.record(session);
    expect(complete.mock.calls[1]?.[1]).toContain("Only the new message");
    expect(complete.mock.calls[1]?.[1]).not.toContain("Only the first message");
    await recorder.undo(recorder.digest()[0]!.id);
    expect(existsSync(join(brain, "Projects/Alpha/OpenItems.md"))).toBe(false);
    expect(sh(brain, "log", "-1", "--format=%s")).toContain("Revert");
  });
});
