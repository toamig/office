import { expect, test } from "@playwright/test";
import { launch, relayUrl } from "./helpers";

// Pending items (M12.1, Simplify 2.4b): derived from live state, in the bell, on Home and in Needs you, only while
// unresolved; no history anywhere.

test("pending items open where they are resolved, vanish when resolved, and leave no history", async () => {
  const { app, data } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const waiting = win.locator('[data-testid="pending-item"][data-kind="waiting"]');
  const gate = win.locator('[data-testid="pending-item"][data-kind="task-gate"]');
  const needsYou = win.locator('[data-testid="pending-item"][data-kind="agent-needs-you"]');

  // Two lines in a project's notes wait on the owner; the bell counts them, amber because nothing is broken.
  await expect(waiting).toHaveCount(2);
  await expect(win.getByTestId("bell-count")).toHaveAttribute("data-tone", "attention");

  // A task stops at its gate, and an agent asks for the owner.
  const task = await win.evaluate(() =>
    window.office.invoke("tasks.create", {
      projectId: "alpha",
      pipeline: "feature",
      title: "Pending task",
      description: "Plan something.",
      fanout: 1,
    }),
  );
  await expect(gate).toContainText("Pending task", { timeout: 60000 });
  const session = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Asker",
    }),
  );
  const post = await fetch(`${relayUrl(data)}/hook/claude`, {
    method: "POST",
    headers: { authorization: "Bearer e2e-token", "content-type": "application/json" },
    body: JSON.stringify({
      session_id: session.id,
      hook_event_name: "Notification",
      message: "Claude needs your permission",
    }),
  });
  expect(post.status).toBe(200);
  await expect(needsYou).toContainText("Asker needs you", { timeout: 30000 });

  // The bell lists them, and the badge counts all four.
  await win.getByTestId("bell").click();
  await expect(win.getByTestId("bell-item")).toHaveCount(4);
  await expect(win.getByTestId("bell-count")).toHaveText("4");

  // Clicking one opens the place where it is resolved.
  await win
    .getByTestId("bell-item")
    .filter({ hasText: "Pending task" })
    .getByTestId("bell-open")
    .click();
  await expect(win.getByTestId("board")).toBeVisible();
  await expect(win.getByTestId("task-detail")).toContainText("Plan something.");
  await win.getByTestId("bell").click();
  await win
    .getByTestId("bell-item")
    .filter({ hasText: "Asker needs you" })
    .getByTestId("bell-open")
    .click();
  await expect(win.getByTestId("agents")).toBeVisible();

  // Resolving it removes it from the bell, Home and Needs you at once: no read state, no history.
  await win.evaluate((id) => window.office.invoke("tasks.cancel", { id }), task.id);
  await win.getByTestId("rail-home").click();
  await expect(gate).toHaveCount(0);
  await win.getByTestId("bell").click();
  await expect(win.getByTestId("bell-item").filter({ hasText: "Pending task" })).toHaveCount(0);
  await win.keyboard.press("Escape");
  await win.getByTestId("rail-inbox").click();
  await expect(win.getByTestId("pending-item").filter({ hasText: "Pending task" })).toHaveCount(0);

  // A line in the notes is ticked off on Home and is gone from the bell too.
  await win.getByTestId("rail-home").click();
  await waiting.first().getByTestId("pending-done").click();
  await expect(waiting).toHaveCount(1);
  await win.getByTestId("bell").click();
  await expect(win.getByTestId("bell-item").filter({ hasText: "Decide the sheep" })).toHaveCount(0);
  await app.close();
});

test("Dismiss hides an item until its state changes, and the bell popover is not a drag region", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const waiting = win.locator('[data-testid="pending-item"][data-kind="waiting"]');
  await expect(waiting).toHaveCount(2);
  await waiting.first().getByTestId("pending-dismiss").click();
  await expect(waiting).toHaveCount(1);
  await expect(win.getByTestId("bell-count")).toHaveText("1");

  // Double-clicking the window's title area maximises it, so nothing in the popover may be part of that area.
  await win.getByTestId("bell").click();
  const region = await win
    .getByTestId("pending-popover")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-app-region"));
  expect(region).toBe("no-drag");
  const inner = await win
    .getByTestId("bell-item")
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-app-region"));
  expect(inner).toBe("no-drag");

  // Pop-ups are never kept: a result leaves the corner and is not listed anywhere.
  await win.evaluate(() => window.office.invoke("app.ping", { text: "x" }));
  await expect(win.getByText("Nothing yet this session")).toHaveCount(0);
  await app.close();
});
