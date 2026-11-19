import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, pick } from "./helpers";

test("a fake provider answer renders with clickable citations that open the note", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await win.getByTestId("rail-brain").click();

  await win.getByTestId("ask-input").fill("What is Alpha?");
  await win.getByTestId("ask-send").click();
  const answer = win.getByTestId("ask-answer");
  await expect(answer).toContainText("Alpha is a fixture game");
  const citations = win.getByTestId("citation");
  await expect(citations).toHaveCount(2);
  await expect(citations.first()).toHaveText("Alpha/Overview.md");

  await citations.first().click();
  await expect(win.getByTestId("note-viewer")).toContainText("Alpha is a fixture game.");
  await app.close();
});

test("a scoped question and a quick note both work", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  const win = await app.firstWindow();
  await win.getByTestId("rail-brain").click();
  await pick(win, "ask-scope", { label: "Alpha" });
  await win.getByTestId("ask-input").fill("Scoped question");
  await win.getByTestId("ask-send").click();
  await expect(win.getByTestId("ask-answer")).toBeVisible();

  await pick(win, "note-project", { label: "Beta" });
  await win.getByTestId("note-text").fill("remember the sheep");
  await win.getByTestId("note-save").click();
  await expect(win.getByTestId("note-message")).toContainText("Noted");
  expect(readFileSync(join(world.hub, "Beta", "OpenItems.md"), "utf8")).toContain(
    "## Notes to file",
  );
  expect(readFileSync(join(world.hub, "Beta", "OpenItems.md"), "utf8")).toContain(
    "remember the sheep",
  );
  await app.close();
});

test("Home writes a morning brief on demand and lists only projects with news", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("brief")).toContainText("No brief yet");
  await win.getByTestId("brief-run").click();
  const items = win.getByTestId("brief-item");
  await expect(items.first()).toContainText("Fake brief for");
  await expect(win.getByTestId("brief")).not.toContainText("No brief yet");
  await win.getByTestId("rail-inbox").click();
  await expect(win.getByTestId("notification").first()).toContainText("morning brief");
  await app.close();
});
