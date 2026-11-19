import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("Home lists live agents and task approvals next to the notes' waiting items", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("home")).toBeVisible();
  await expect(win.getByTestId("live-agent")).toHaveCount(0);

  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Home agent",
    }),
  );
  await expect(win.getByTestId("live-agent")).toContainText("Home agent", { timeout: 20000 });

  // A task stops at its plan gate, which is something waiting on the owner.
  await win.evaluate(() =>
    window.office.invoke("tasks.create", {
      projectId: "alpha",
      pipeline: "feature",
      title: "Home task",
      description: "Plan something.",
      fanout: 1,
    }),
  );
  await expect(win.getByTestId("waiting-gate")).toContainText("Home task", { timeout: 60000 });
  await win.getByTestId("open-waiting-gate").click();
  await expect(win.getByTestId("board")).toBeVisible();

  // The Today panel is always there, even with no automations.
  await win.getByTestId("rail-home").click();
  await expect(win.getByText("No automations are due today.")).toBeVisible();
  await app.close();
});
