import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { channels } from "../../src/shared/ipc";
import { isMutation, READ_CHANNELS } from "../../src/shared/channel-kinds";

const RENDERER = resolve(__dirname, "../../src/renderer/src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("read channels", () => {
  it("are all real channels", () => {
    for (const c of READ_CHANNELS) expect(Object.keys(channels)).toContain(c);
  });

  it("include every channel a view reads through the query cache or prefetches", () => {
    const used = new Set<string>();
    for (const file of sources(RENDERER)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(?:useQuery|prefetch)\(\s*"([a-zA-Z.]+)"/g))
        used.add(m[1] as string);
    }
    expect(used.size).toBeGreaterThan(20);
    const notReads = [...used].filter((c) => !READ_CHANNELS.includes(c as never));
    expect(notReads).toEqual([]);
  });

  it("make a call count as a change only when it is not a read or window plumbing", () => {
    expect(isMutation("projects.list")).toBe(false);
    expect(isMutation("layout.set")).toBe(false);
    expect(isMutation("preview.bounds")).toBe(false);
    expect(isMutation("app.popupMenu")).toBe(false);
    expect(isMutation("sessions.kill")).toBe(true);
    expect(isMutation("pending.dismiss")).toBe(true);
  });
});
