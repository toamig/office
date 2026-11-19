import { describe, expect, it } from "vitest";
import { effortsFor, modelFits } from "../../src/shared/roles";
import { plainCause } from "../../src/renderer/src/ui/Notifications";

const known = { "claude-code": ["opus", "sonnet", "haiku"], codex: ["gpt-5-codex"] };

describe("a role's provider, model and effort", () => {
  it("offers only the effort levels the provider accepts", () => {
    expect(effortsFor("claude-code")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // Codex has no "max": Office sends it as "xhigh", so it would be the same choice twice.
    expect(effortsFor("codex")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(effortsFor("something-new")).toContain("max");
  });

  it("flags a model that belongs to another provider, and nothing chosen always fits", () => {
    expect(modelFits("claude-code", undefined, known)).toBe(true);
    expect(modelFits("claude-code", "sonnet", known)).toBe(true);
    // The owner's case: Claude Code paired with a Codex-style model name.
    expect(modelFits("claude-code", "gpt-6.1-terra", known)).toBe(false);
    expect(modelFits("claude-code", "gpt-5-codex", known)).toBe(false);
    expect(modelFits("codex", "gpt-5-codex", known)).toBe(true);
    // Codex has no model list, so a name nobody else owns is accepted; a Claude model is not.
    expect(modelFits("codex", "gpt-6.1-terra", known)).toBe(true);
    expect(modelFits("codex", "opus", known)).toBe(false);
  });
});

describe("error causes in plain words", () => {
  it("drops the transport's wrapping and keeps the reason", () => {
    expect(
      plainCause(
        new Error("Error invoking remote method 'chat.send': Error: The tool is not logged in"),
      ),
    ).toBe("The tool is not logged in");
    expect(plainCause("plain text")).toBe("plain text");
    expect(plainCause(new Error(""))).toBe("Something went wrong.");
  });
});
