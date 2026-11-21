import { describe, expect, it, vi } from "vitest";
import { OfficeTools } from "../../src/main/modules/chat/office-tools";
import { parseOfficeCall } from "../../src/main/modules/chat/office-tool-plan";
import { ConversationBridge } from "../../src/main/modules/runs/mcp-config";

const input = { name: "Weekly review", prompt: "Summarize the week", schedule: "0 9 * * 6" };

function fixture(autonomy: string, incognito = false) {
  const saveWorkflow = vi.fn(async () => undefined);
  const spawn = vi.fn(async () => ({ ok: true, sessionId: "new", projectId: "project" }));
  const tool = new OfficeTools({
    bus: { emit: vi.fn() },
    store: { state: { workspace: null } },
    settings: () => ({ workspaceRoot: "test-workspace" }),
    sessions: { find: () => ({ running: true, autonomy, incognito }) },
    editor: { saveWorkflow },
    explore: { plan: vi.fn(), spawn },
  } as unknown as ConstructorParameters<typeof OfficeTools>[0]);
  const abort = new AbortController();
  return {
    tool, saveWorkflow, spawn, abort,
    call: (name: string, args: unknown) =>
      tool.request("chat", { kind: "call", name, arguments: args }, abort.signal),
  };
}

describe("Office tool validation", () => {
  it("rejects unknown tools and fields and preserves omitted workflow fields", () => {
    expect(() => parseOfficeCall("toString", {})).toThrow();
    expect(() => parseOfficeCall("office_create_project", { name: "A", publicConfirmed: true })).toThrow();
    expect(parseOfficeCall("office_update_workflow", { id: "weekly-review", name: "New name" }).input)
      .toEqual({ id: "weekly-review", name: "New name" });
  });

  it("waits, scopes the card to its conversation, and saves the owner's edits once", async () => {
    const { tool, saveWorkflow, call } = fixture("ask-first");
    const result = call("office_create_workflow", input);
    const [card] = tool.list("chat");
    expect(card?.preview).toContainEqual({ label: "Schedule", text: "Every Saturday at 09:00" });
    expect(saveWorkflow).not.toHaveBeenCalled();
    await expect(tool.answer("other-chat", card!.id, true)).rejects.toThrow();
    await expect(tool.answer("chat", card!.id, true, { id: "other" })).rejects.toThrow();
    await tool.answer("chat", card!.id, true, { name: "New name" });
    expect(await result).toMatchObject({ id: "new-name" });
    await expect(tool.answer("chat", card!.id, true)).rejects.toThrow();
    expect(saveWorkflow).toHaveBeenCalledTimes(1);
  });

  it("does not apply a discarded or interrupted proposal", async () => {
    const { tool, saveWorkflow, call, abort } = fixture("ask-first");
    const discarded = call("office_create_workflow", input);
    await tool.answer("chat", tool.list("chat")[0]!.id, false);
    expect(await discarded).toHaveProperty("error");
    const disconnected = call("office_create_workflow", input);
    abort.abort();
    expect(await disconnected).toHaveProperty("error");
    expect(tool.list("chat")).toEqual([]);
    expect(saveWorkflow).not.toHaveBeenCalled();
  });

  it("applies ordinary actions under Full auto and still waits for public projects", async () => {
    const { tool, saveWorkflow, spawn, call } = fixture("full-auto");
    expect(await call("office_create_workflow", input)).toHaveProperty("id", "weekly-review");
    expect(saveWorkflow).toHaveBeenCalledTimes(1);
    expect(tool.list("chat")).toEqual([]);
    const result = call("office_create_project", { name: "Public example", visibility: "public" });
    expect(spawn).not.toHaveBeenCalled();
    await tool.answer("chat", tool.list("chat")[0]!.id, true);
    expect(await result).toHaveProperty("projectId", "project");
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ publicConfirmed: true }));
  });

  it("rejects incognito requests and scopes tokens to the active workspace and conversation", async () => {
    const { call } = fixture("full-auto", true);
    expect(await call("office_create_workflow", input)).toHaveProperty("error");
    let root = "first-root";
    const bridge = new ConversationBridge("test-script.mjs", () => root);
    const token = `Bearer ${bridge.config("chat").env["OFFICE_CONVERSATION_TOKEN"]}`;
    expect(bridge.valid("chat", token)).toBe(true);
    expect(bridge.valid("other", token)).toBe(false);
    root = "second-root";
    expect(bridge.valid("chat", token)).toBe(false);
  });
});
