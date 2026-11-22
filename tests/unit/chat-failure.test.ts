import { describe, expect, it } from "vitest";
import { chatFailure } from "../../src/shared/chat-failure";

describe("chat failure recovery", () => {
  it("offers login for expired OAuth and missing credentials", () => {
    expect(chatFailure("OAuth session expired and could not be refreshed", "Claude Code")).toEqual({
      kind: "login", text: "Claude Code is signed out. Log in again to continue.", action: "Log in",
    });
    expect(chatFailure("Refresh token has already been used", "Codex").kind).toBe("login");
  });

  it("keeps the usage reset time and distinguishes model and network errors", () => {
    expect(chatFailure("You've hit your limit. Resets at 16:30 (Europe/Lisbon)", "Claude Code")).toMatchObject({
      kind: "limit", text: "Usage limit reached. Reset time: 16:30 (Europe/Lisbon)", action: "Retry",
    });
    expect(chatFailure("The model test-model does not exist", "Claude Code").action).toBe("Use the default model");
    expect(chatFailure("getaddrinfo ENOTFOUND", "Codex").kind).toBe("network");
  });

  it("keeps unknown CLI output in Details", () => {
    expect(chatFailure("Unexpected process response", "Claude Code")).toEqual({
      kind: "unknown", text: "The turn failed", action: "Retry", details: "Unexpected process response",
    });
  });
});
