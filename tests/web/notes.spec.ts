import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./helpers";

// M12.4 (Simplify 2.4): a project's notes are formatted documents, and their source is clear.

const DESIGN = `---
type: spec
domain: meta
project: Alpha
summary: How the sheep counter plays, in plain words.
tags: [roadmap]
answers:
  - How does the sheep counter play?
authority: own
---

# Alpha: design

The counter shows how many sheep jumped. See [[Alpha/Overview#Positioning and vision]] for the idea.

## Rules

| Sheep | Points |
| ----- | ------ |
| Black | 5      |
| White | 1      |

\`\`\`
count = sheep.length
\`\`\`

## Later

Things for after the first version, and [[Nowhere/Missing]] is not a note.

## Extras

More detail.
`;

const AUDIT = `---
type: audit
domain: meta
project: Alpha
summary: What the audit found.
tags: [roadmap]
answers:
  - What did the audit find?
authority: own
---

# Alpha: content audit

Nothing urgent.
`;

test("a note is a formatted document: summary, contents, folding sections, links and a source", async () => {
  const { app, world } = await launch({ world: true, fakeTools: true });
  if (!world) throw new Error("no world");
  writeFileSync(join(world.hub, "Alpha", "Design.md"), DESIGN);
  writeFileSync(join(world.hub, "Alpha", "ContentAudit.md"), AUDIT);
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1700, height: 950 });
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("tab-notes").click();

  // The calm notes are offered; audits and implementation notes wait behind Show more.
  const picker = win.getByTestId("note-picker");
  await expect(picker.getByRole("button", { name: "Design" })).toBeVisible({ timeout: 15000 });
  await expect(picker.getByRole("button", { name: "ContentAudit" })).toHaveCount(0);
  await picker.getByRole("button", { name: "Design" }).click();

  // It opens with its own summary and a contents list.
  const doc = win.getByTestId("note-doc");
  await expect(win.getByTestId("note-summary")).toHaveText(
    "How the sheep counter plays, in plain words.",
  );
  await expect(win.getByTestId("note-contents")).toContainText("Rules");
  await expect(win.getByTestId("note-contents")).toContainText("Later");
  await expect(win.getByTestId("note-contents")).toContainText("Extras");

  // Headings, a table and a code block are drawn, and no raw syntax shows.
  await expect(doc.locator("table")).toHaveCount(1);
  await expect(doc.locator("pre code")).toContainText("count = sheep.length");
  const text = await doc.innerText();
  expect(text).not.toContain("[[");
  expect(text).not.toContain("| -----");
  expect(text).not.toMatch(/^#{1,6} /m);
  // The first section is open, the others fold.
  const sections = win.getByTestId("note-section");
  await expect(sections.nth(0)).toHaveAttribute("open", "");
  await expect(sections.nth(1)).not.toHaveAttribute("open", "");
  await win.getByTestId("note-contents").getByRole("button", { name: "Later" }).click();
  await expect(sections.nth(1)).toHaveAttribute("open", "");
  // A link to a note that cannot be opened is plain text, not a dead link.
  await expect(sections.nth(1)).toContainText("Missing");
  await expect(sections.nth(1).getByTestId("wiki-link")).toHaveCount(0);

  // The source is named, with Open in editor.
  await expect(win.getByTestId("note-source")).toContainText("Source: Alpha/Design.md");
  await expect(win.getByTestId("note-open-editor")).toBeVisible();

  // A wiki link opens that note in Office, at that section.
  await doc.getByTestId("wiki-link").first().click();
  await expect(win.getByTestId("note-summary")).toHaveText("What Alpha is.");
  await expect(win.getByTestId("note-source")).toContainText("Source: Alpha/Overview.md");

  // Show more brings the audit.
  await win.getByTestId("notes-more").click();
  await expect(picker.getByRole("button", { name: "ContentAudit" })).toBeVisible();
  await picker.getByRole("button", { name: "ContentAudit" }).click();
  await expect(win.getByTestId("note-summary")).toHaveText("What the audit found.");
  await app.close();
});
