import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

describe("unseen test runs", () => {
  it("is on only when the helper says so", async () => {
    const { isE2E } = await import("../../src/main/e2e");
    const before = process.env["OFFICE_E2E"];
    delete process.env["OFFICE_E2E"];
    expect(isE2E()).toBe(false);
    process.env["OFFICE_E2E"] = "1";
    expect(isE2E()).toBe(true);
    if (before === undefined) delete process.env["OFFICE_E2E"];
    else process.env["OFFICE_E2E"] = before;
  });

  it("creates windows hidden, off the taskbar, and painting", async () => {
    const { unseenWindowOptions } = await import("../../src/main/e2e");
    expect(unseenWindowOptions()).toEqual({
      show: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
    });
  });
});
