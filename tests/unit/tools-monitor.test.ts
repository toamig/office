import { describe, expect, it, vi } from "vitest";
import type { ToolStatus } from "../../src/shared/models";
import { ToolsMonitor } from "../../src/main/modules/setup/tools-monitor";

const git: ToolStatus = { id: "git", label: "Git", installed: true, loggedIn: null };

describe("ToolsMonitor", () => {
  it("has no answer before the first look, then keeps the last one", async () => {
    const detect = vi.fn(async () => [git]);
    const changed = vi.fn();
    const monitor = new ToolsMonitor(detect, changed);
    expect(monitor.current).toBeNull();
    expect(await monitor.read()).toEqual([git]);
    expect(await monitor.read()).toEqual([git]);
    expect(await monitor.read()).toEqual([git]);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("never runs the tools twice at once", async () => {
    const detect = vi.fn(async () => [git]);
    const monitor = new ToolsMonitor(detect, () => undefined);
    await Promise.all([monitor.check(), monitor.check(), monitor.check()]);
    expect(detect).toHaveBeenCalledTimes(1);
    await monitor.check();
    expect(detect).toHaveBeenCalledTimes(2);
  });
});
