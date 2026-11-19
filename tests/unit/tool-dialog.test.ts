import { describe, expect, it } from "vitest";
import { firstUrl } from "../../src/renderer/src/lib/output";

describe("firstUrl", () => {
  it("finds the sign-in address in what the program printed, past colour codes", () => {
    const esc = String.fromCharCode(27);
    const out = `Opening browser to sign in\r\n${esc}[36mhttps://claude.example/oauth/authorize?code=true&client_id=abc${esc}[0m\r\nPaste code here if prompted > `;
    expect(firstUrl(out)).toBe("https://claude.example/oauth/authorize?code=true&client_id=abc");
  });
  it("is null when there is no address", () => {
    expect(firstUrl("Waiting for login...")).toBeNull();
  });
});
