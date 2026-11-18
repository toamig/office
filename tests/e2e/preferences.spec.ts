import { expect, test } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./helpers";

test("theme, accent and density apply at once and are saved in the machine settings", async () => {
  const { app, data } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-setup").click();

  await win.getByTestId("theme-dark").check();
  await expect(win.locator("html")).toHaveAttribute("data-theme", "dark");
  await win.getByTestId("theme-light").check();
  await expect(win.locator("html")).toHaveAttribute("data-theme", "light");
  await win.getByTestId("density-compact").check();
  await expect(win.locator("html")).toHaveAttribute("data-density", "compact");
  await win.getByTestId("accent").fill("#c0392b");
  await expect(win.locator("html")).toHaveCSS("--accent", "#c0392b");

  const saved = JSON.parse(readFileSync(join(data, "settings.json"), "utf8"));
  expect(saved).toMatchObject({ theme: "light", density: "compact", accent: "#c0392b" });
  await app.close();
});

test("phone pings: a test ping reaches the ntfy topic URL, and rules are saved in the workspace config", async () => {
  const received: Array<{ url: string; body: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const topic = `http://127.0.0.1:${(server.address() as AddressInfo).port}/office-test`;
  try {
    const { app, world } = await launch({ world: true, fakeTools: true });
    if (!world) throw new Error("no world");
    const win = await app.firstWindow();
    await win.getByTestId("rail-setup").click();
    await win.getByTestId("ntfy-url").fill(topic);
    await win.getByTestId("ntfy-save").click();
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8")).notifications
            .ntfyTopicUrl,
        { timeout: 30000 },
      )
      .toBe(topic);
    await win.getByTestId("ntfy-test").click();
    await expect.poll(() => received.length, { timeout: 15000 }).toBe(1);
    expect(received[0]?.url).toContain("/office-test?title=Office+test+ping");
    expect(received[0]?.body).toContain("phone pings work");

    await win.getByTestId("mute-alpha").click();
    await win.getByTestId("urgent-agent.done").click();
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(join(world.hub, world.workspaceConfigPath), "utf8"))
            .notifications,
        { timeout: 30000 },
      )
      .toMatchObject({
        mutedProjects: ["alpha"],
        urgent: expect.arrayContaining(["agent.done", "agent.needs-you"]),
      });
    await app.close();
  } finally {
    server.close();
  }
});
