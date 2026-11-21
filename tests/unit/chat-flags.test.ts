import { describe, expect, it } from "vitest";
import {
  CHAT_TOOLS,
  ClaudeCodeProvider,
  chatToolFlags,
} from "../../src/main/modules/providers/claude-code";

const provider = new ClaudeCodeProvider({ bin: "claude" });
const base = {
  cwd: "C:/chats/one",
  officeSessionId: "chat-1",
  resume: false,
  permission: { kind: "readonly" as const },
  runDir: "C:/chats/one",
  restricted: true,
  addDirs: ["C:/brain"],
};

describe("the exact flags of a Chat", () => {
  it("a saved chat reads the brain and the web only, and is refused everything else without asking", () => {
    const { args } = provider.chatCommand(base);
    expect(args).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--session-id",
      "chat-1",
      "--tools",
      "Read,Grep,Glob,WebSearch,WebFetch,Agent",
      "--allowedTools",
      "Read,Grep,Glob,WebSearch,WebFetch,Agent",
      "--permission-mode",
      "dontAsk",
      "--strict-mcp-config",
      "--add-dir",
      "C:/brain",
    ]);
    expect(CHAT_TOOLS).toBe("Read,Grep,Glob,WebSearch,WebFetch,Agent");
    // Nothing that runs a command or edits a file is ever offered, and no approval tool is attached.
    expect(args.join(" ")).not.toMatch(/Bash|Edit|Write|permission-prompt/);
  });

  it("a saved chat resumes its conversation; an incognito chat never does and keeps nothing", () => {
    const resumed = provider.chatCommand({ ...base, resume: true }).args;
    expect(resumed).toContain("--resume");
    expect(resumed).not.toContain("--no-session-persistence");
    const incognito = provider.chatCommand({ ...base, resume: true, incognito: true }).args;
    expect(incognito).not.toContain("--resume");
    expect(incognito).toContain("--no-session-persistence");
    expect(
      incognito.slice(incognito.indexOf("--session-id"), incognito.indexOf("--session-id") + 2),
    ).toEqual(["--session-id", "chat-1"]);
    // Same tools and the same permission mode as a saved chat.
    expect(incognito).toEqual(
      expect.arrayContaining(["--tools", CHAT_TOOLS, "--permission-mode", "dontAsk"]),
    );
  });

  it("a chat's model is passed, and an ordinary agent chat is unchanged", () => {
    expect(chatToolFlags([], "haiku").slice(0, 2)).toEqual(["--model", "haiku"]);
    const ordinary = provider.chatCommand({
      ...base,
      restricted: false,
      addDirs: [],
      permission: { kind: "ask", mcpConfig: "C:/mcp.json" },
    }).args;
    expect(ordinary).not.toContain("--tools");
    expect(ordinary).toContain("--permission-mode");
    expect(ordinary).toContain("manual");
  });
});
