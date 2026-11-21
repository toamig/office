import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("a fake CLI proposes a workflow and saves it after confirmation", async () => {
  const { app, page } = await launch({ world: true, fakeTools: true });
  try {
    await expect(page.getByTestId("topbar")).toBeVisible();
    await page.evaluate(() => window.office.invoke("sessions.start", {
      projectId: "alpha", providerId: "fake", mode: "chat",
    }));
    await page.getByTestId("rail-agents").click();
    await page.getByTestId("session-row").first().click();
    const composer = page.getByTestId("composer-input");
    await composer.fill("OFFICE_WORKFLOW");
    await composer.press("Enter");
    const card = page.getByTestId("office-confirmation");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Weekly review");
    await expect(card).toContainText("Saturday");
    const workflows = () => page.evaluate(() => window.office.invoke("workflows.list"));
    expect(await workflows()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "weekly-review" })]));
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("chat-assistant").last()).toContainText("Saved Weekly review");
    expect(await workflows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "weekly-review", schedule: "0 9 * * 6", prompt: "Summarize the week" }),
    ]));
  } finally {
    await app.close();
  }
});
