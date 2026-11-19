import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, pick, toasts } from "./helpers";

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
  await expect(toasts(win).filter({ hasText: "Noted" })).toBeVisible();
  expect(readFileSync(join(world.hub, "Beta", "OpenItems.md"), "utf8")).toContain(
    "## Notes to file",
  );
  expect(readFileSync(join(world.hub, "Beta", "OpenItems.md"), "utf8")).toContain(
    "remember the sheep",
  );
  await app.close();
});

test("Home shows the brief as a few plain lines, each leading to its place, with the facts under Show details", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("brief")).toContainText("No brief yet");
  await win.getByTestId("brief-run").click();
  const lines = win.getByTestId("brief-line");
  await expect(lines.first()).toContainText("changed", { timeout: 30000 });
  // Three to five lines, no markdown syntax, nothing of the facts until asked.
  expect(await lines.count()).toBeGreaterThanOrEqual(3);
  expect(await lines.count()).toBeLessThanOrEqual(5);
  await expect(win.getByTestId("brief")).not.toContainText(/[*#`]/);
  await expect(win.getByTestId("brief-item")).toHaveCount(0);
  await win.getByTestId("brief-details").click();
  await expect(win.getByTestId("brief-item").first()).toContainText("initial");
  await win.getByTestId("brief-details").click();
  await expect(win.getByTestId("brief-item")).toHaveCount(0);
  // A line leads to its place: the first one is about a project.
  await lines.first().getByRole("button").click();
  await expect(win.getByTestId("project-page")).toBeVisible();
  // A brief is a result, not something that waits on the owner: it is not in the Needs you list.
  await win.getByTestId("rail-inbox").click();
  await expect(win.getByTestId("pending-item").filter({ hasText: "brief" })).toHaveCount(0);
  await app.close();
});
