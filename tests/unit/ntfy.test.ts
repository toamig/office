import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Bus } from "../../src/main/core/bus";
import { NtfyChannel } from "../../src/main/core/channels/ntfy";
import { openDb } from "../../src/main/core/db";
import { Notifier } from "../../src/main/core/notifier";
import type { Workspace } from "../../src/shared/types";

interface Received {
  method: string;
  url: string;
  type: string;
  body: string;
}

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function stub(status = 200): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({
        method: req.method ?? "",
        url: req.url ?? "",
        type: String(req.headers["content-type"]),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.statusCode = status;
      res.end("ok");
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/my-topic`, received };
}

const workspace = (ntfy?: string): Workspace => ({
  version: 1,
  vault: { kind: "none", openItemsFile: "OpenItems.md", waitingHeading: "Waiting on you" },
  projects: [],
  roles: {},
  pipelines: {},
  notifications: {
    urgent: ["agent.needs-you"],
    mutedProjects: [],
    ...(ntfy ? { ntfyTopicUrl: ntfy } : {}),
  },
  automations: [],
  archiveAfterDays: 7,
  briefTime: "08:00",
});

async function until(cond: () => boolean): Promise<void> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
}

describe("ntfy channel", () => {
  it("a local HTTP stub receives the POST for an urgent notification, with title and body and no click link", async () => {
    const { url, received } = await stub();
    const db = openDb(":memory:");
    const ws = workspace(url);
    const notifier = new Notifier({
      db,
      bus: new Bus(),
      workspace: () => ws,
      quietHours: () => undefined,
    });
    notifier.addChannel(new NtfyChannel(() => ws.notifications.ntfyTopicUrl));

    notifier.notify({
      kind: "agent.needs-you",
      title: "Builder needs you: café",
      body: "Do you want to proceed?",
      link: { view: "agents" },
    });
    notifier.notify({ kind: "agent.done", title: "Not urgent", body: "calm" });
    await until(() => received.length >= 1);
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: "POST", body: "Do you want to proceed?" });
    expect(received[0]?.type).toContain("text/plain");
    const parsed = new URL(received[0]?.url ?? "", "http://x");
    expect(parsed.pathname).toBe("/my-topic");
    expect(parsed.searchParams.get("title")).toBe("Builder needs you: café");
    expect(received[0]?.url).not.toContain("click");
  });

  it("does nothing without a topic URL, and reports a bad answer or a bad URL", async () => {
    const quiet = new NtfyChannel(() => undefined);
    await expect(quiet.post("t", "b")).resolves.toBeUndefined();
    const { url } = await stub(500);
    await expect(new NtfyChannel(() => url).post("t", "b")).rejects.toThrow(/500/);
    await expect(new NtfyChannel(() => "ftp://example.invalid/x").post("t", "b")).rejects.toThrow(
      /http or https/,
    );
  });

  it("is skipped for a muted project and during quiet hours like every other channel", async () => {
    const { url, received } = await stub();
    const db = openDb(":memory:");
    const ws = workspace(url);
    ws.notifications.mutedProjects = ["quiet"];
    const notifier = new Notifier({
      db,
      bus: new Bus(),
      workspace: () => ws,
      quietHours: () => undefined,
    });
    notifier.addChannel(new NtfyChannel(() => ws.notifications.ntfyTopicUrl));
    notifier.notify({ kind: "agent.needs-you", projectId: "quiet", title: "Muted", body: "x" });
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(0);
  });
});
