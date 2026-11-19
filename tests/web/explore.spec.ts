import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sh } from "../fixtures/repos/make";
import { launch, pageMenu, pick } from "./helpers";

// Chat (M12.3, Simplify 2.3): a plain conversation that reads the notes and the web; saved chats named by their first
// message; incognito chats that keep nothing; and Turn into a project.

async function say(win: Page, text: string): Promise<void> {
  const box = win.getByTestId("composer-input");
  await box.fill(text);
  await box.press("Enter");
}

test("a chat is named by its first message, and Turn into a project makes one with gh replaced by a fake", async () => {
  const { app, world, ghRemotes } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();

  await win.getByTestId("rail-explore").click();
  await expect(win.getByRole("heading", { level: 1 })).toHaveText("Chat");
  await win.getByTestId("explore-start").click();
  await expect(win.getByTestId("explore-row")).toHaveCount(1);
  await expect(win.getByTestId("chat-name")).toHaveText("New chat");
  // The empty state and the composer line up in one centred column.
  await expect(win.getByTestId("chat-empty")).toContainText(
    "It can read your notes and search the web",
  );
  // A chat has no wrap up, no terminal and no permission modes.
  await expect(win.getByTestId("wrap-up")).toHaveCount(0);
  await expect(win.getByTestId("chat-more")).toHaveCount(0);
  await expect(win.getByTestId("chat-permission-mode")).toHaveCount(0);

  await say(win, "What would a sheep counter game need?");
  await expect(win.getByTestId("chat")).toContainText("echo: What would a sheep counter", {
    timeout: 30000,
  });
  await expect(win.getByTestId("chat-name")).toHaveText("What would a sheep counter game need?");

  await pageMenu(win, "make-project");
  await expect(win.getByTestId("spawn-wizard")).toBeVisible();
  await win.getByTestId("spawn-name").fill("Sheep Dream");
  await win.getByTestId("spawn-stack").fill("a Node and React web app");
  await win.getByTestId("spawn-group").fill("Games");

  // Every step is shown before it runs; nothing exists yet.
  await win.getByTestId("spawn-review").click();
  await expect(win.getByTestId("spawn-step")).toHaveCount(7);
  await expect(win.getByTestId("spawn-steps")).toContainText(
    "gh repo create <you>/sheep-dream --private",
  );
  expect(existsSync(join(world.projectsRoot, "SheepDream"))).toBe(false);

  await win.getByTestId("spawn-run").click();
  await expect(win.getByTestId("spawn-open")).toBeVisible({ timeout: 60000 });
  await expect(win.locator('[data-testid="spawn-step"][data-status="done"]')).toHaveCount(7);

  // The code repo, the brain repo and the hub all changed; the fixture hub still validates.
  expect(existsSync(join(world.projectsRoot, "SheepDream", "AGENTS.md"))).toBe(true);
  expect(readFileSync(join(ghRemotes, "gh.log"), "utf8")).toContain('"--private"');
  expect(sh(join(world.hub, "SheepDream"), "log", "-1", "--format=%s")).toContain("Sheep Dream");
  expect(readFileSync(join(world.hub, "brain.repos.json"), "utf8")).toContain("brain-sheep-dream");
  expect(sh(world.hub, "log", "-1", "--format=%s").trim()).toBe("Add Sheep Dream to the hub");
  const validate = await win.evaluate(() => window.office.invoke("vault.health"));
  expect(validate.validate).toMatchObject({ ran: true, ok: true });

  // The project is in Office and an agent session started in its folder.
  await win.getByTestId("spawn-open").click();
  await expect(win.getByTestId("project-page")).toContainText("Sheep Dream");
  const sessions = await win.evaluate(() =>
    window.office.invoke("sessions.list", { projectId: "sheep-dream" }),
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.cwd).toBe(join(world.projectsRoot, "SheepDream"));
  await app.close();
});

test("a public repo cannot be created without its own explicit checkbox", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-explore").click();
  await win.getByTestId("explore-start").click();
  await expect(win.getByTestId("explore-row")).toHaveCount(1);
  await pageMenu(win, "make-project");
  await win.getByTestId("spawn-name").fill("Open Thing");
  await pick(win, "spawn-visibility", "public");
  await win.getByTestId("spawn-review").click();
  await expect(win.getByTestId("spawn-steps")).toContainText("--public");
  await expect(win.getByTestId("spawn-run")).toBeDisabled();
  await win.getByRole("button", { name: "Back" }).click();
  await win.getByTestId("spawn-public-ok").check();
  await win.getByTestId("spawn-review").click();
  await expect(win.getByTestId("spawn-run")).toBeEnabled();
  expect(existsSync(join(world.projectsRoot, "OpenThing"))).toBe(false);
  await app.close();
});

test("an incognito chat leaves no folder, log, list entry or notification once it is closed", async () => {
  const { app, data } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const chatsBefore = existsSync(join(data, "chats")) ? readdirSync(join(data, "chats")) : [];

  await win.getByTestId("rail-explore").click();
  await win.getByTestId("chat-incognito").check();
  await win.getByTestId("explore-start").click();
  const row = win.locator('[data-testid="explore-row"][data-incognito="true"]');
  await expect(row).toHaveCount(1);
  await expect(win.getByTestId("incognito-note")).toContainText(
    "Incognito. Nothing is kept when you close it.",
  );
  await say(win, "A private question about the sheep");
  await expect(win.getByTestId("chat")).toContainText("echo: A private question", {
    timeout: 30000,
  });
  // It keeps its own name: a private message is never turned into a title.
  await expect(win.getByTestId("chat-name")).toHaveText("Incognito chat");

  // While it is open it lives in a temporary folder and nowhere in the app's data, and no list has it.
  const incognito = await win.evaluate(async () => {
    const saved = await window.office.invoke("explore.list");
    const all = await window.office.invoke("sessions.list", {});
    return { saved: saved.length, all: all.length };
  });
  expect(incognito).toEqual({ saved: 0, all: 0 });
  const id = await row.evaluate(() =>
    document.querySelector('[data-testid="chat"]')?.getAttribute("data-session"),
  );
  expect(id).toBeTruthy();
  const cwd = (await win.evaluate((sid) => window.office.invoke("sessions.get", { id: sid }), id!))
    .cwd;
  expect(existsSync(cwd)).toBe(true);
  expect(existsSync(join(data, "chats", id!))).toBe(false);
  // Nothing waits on the owner because of it.
  expect(await win.evaluate(() => window.office.invoke("pending.list"))).not.toContainEqual(
    expect.objectContaining({ title: expect.stringContaining("Incognito") }),
  );

  // Closing asks first, then erases everything.
  await win.getByTestId("incognito-close").click();
  await win.getByTestId("incognito-close-confirm").click();
  await expect(row).toHaveCount(0);
  expect(existsSync(cwd)).toBe(false);
  const chatsAfter = existsSync(join(data, "chats")) ? readdirSync(join(data, "chats")) : [];
  expect(chatsAfter).toEqual(chatsBefore);
  const after = await win.evaluate(async (sid) => {
    try {
      await window.office.invoke("sessions.get", { id: sid });
      return "still there";
    } catch {
      return "gone";
    }
  }, id!);
  expect(after).toBe("gone");
  expect(await win.evaluate(() => window.office.invoke("pending.list"))).toEqual(
    expect.not.arrayContaining([expect.objectContaining({ kind: "agent-needs-you" })]),
  );
  await app.close();
});

test("an incognito chat can become a project only after incognito is turned off, which asks first", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-explore").click();
  await win.getByTestId("chat-incognito").check();
  await win.getByTestId("explore-start").click();
  await say(win, "Could this be a game?");
  await expect(win.getByTestId("chat")).toContainText("echo: Could this be a game?", {
    timeout: 30000,
  });
  await pageMenu(win, "make-project");
  // It asks, and staying incognito leaves the chat as it was.
  await expect(win.getByTestId("incognito-keep-dialog")).toBeVisible();
  await win.getByRole("button", { name: "Stay incognito" }).click();
  await expect(win.getByTestId("spawn-wizard")).toHaveCount(0);
  await expect(win.locator('[data-testid="explore-row"][data-incognito="true"]')).toHaveCount(1);
  await pageMenu(win, "make-project");
  await win.getByTestId("incognito-keep").click();
  await expect(win.getByTestId("spawn-wizard")).toBeVisible();
  // It is now an ordinary saved chat, in the list, with what was said so far.
  await expect(win.locator('[data-testid="explore-row"][data-incognito="true"]')).toHaveCount(0);
  await expect(win.getByTestId("explore-row")).toHaveCount(1);
  await app.close();
});

test("saved chats can be pinned and renamed, and Ctrl+Shift+N starts an incognito chat", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-explore").click();
  await win.getByTestId("explore-start").click();
  await say(win, "Plan a sheep counter");
  await expect(win.getByTestId("chat-name")).toHaveText("Plan a sheep counter", { timeout: 30000 });
  await win.getByTestId("explore-row").hover();
  await win.getByTestId("chat-rename").click();
  await win.getByTestId("chat-rename-name").fill("Sheep counter plan");
  await win.getByTestId("chat-rename-save").click();
  await expect(win.getByTestId("chat-name")).toHaveText("Sheep counter plan");
  await win.getByTestId("explore-row").hover();
  await win.getByTestId("chat-pin").click();
  const saved = await win.evaluate(() => window.office.invoke("explore.list"));
  expect(saved[0]).toMatchObject({ title: "Sheep counter plan", pinned: true, incognito: false });

  await win.getByTestId("rail-home").click();
  await win.keyboard.press("Control+Shift+N");
  await expect(win.getByRole("heading", { level: 1 })).toHaveText("Chat");
  await expect(win.locator('[data-testid="explore-row"][data-incognito="true"]')).toHaveCount(1);
  await app.close();
});
