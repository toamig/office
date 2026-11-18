import { describe, expect, it } from "vitest";
import { isAllowedNavigation, isAppRequest } from "../../src/main/core/window-security";

describe("window navigation", () => {
  it("allows only the dev server's own origin while developing", () => {
    const dev = "http://localhost:5173/";
    expect(isAllowedNavigation("http://localhost:5173/#/inbox", dev)).toBe(true);
    expect(isAllowedNavigation("http://localhost.example.com/", dev)).toBe(false);
    expect(isAllowedNavigation("http://localhost:5174/", dev)).toBe(false);
    expect(isAllowedNavigation("http://localhost/", dev)).toBe(false);
    expect(isAllowedNavigation("https://example.com/", dev)).toBe(false);
    expect(isAllowedNavigation("file:///app/index.html", dev)).toBe(false);
    expect(isAllowedNavigation("not a url", dev)).toBe(false);
  });

  it("allows only the app's own file in a packaged build", () => {
    expect(isAllowedNavigation("file:///app/index.html", undefined)).toBe(true);
    expect(isAllowedNavigation("http://localhost:5173/", undefined)).toBe(false);
    expect(isAllowedNavigation("https://example.com/", undefined)).toBe(false);
  });
});

describe("content security policy scope", () => {
  it("applies to the app window's requests and not to a previewed page", () => {
    expect(isAppRequest(3, 3)).toBe(true);
    expect(isAppRequest(7, 3)).toBe(false);
    expect(isAppRequest(undefined, 3)).toBe(false);
  });
});
