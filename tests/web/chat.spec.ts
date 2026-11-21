import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("a chat sends a message and receives an answer", async () => {
  const { app, page } = await launch({ world: true, fakeTools: true });
  try {
    await expect(page.getByTestId("topbar")).toBeVisible();
    await page.evaluate(() =>
      window.office.invoke("sessions.start", {
        projectId: "alpha",
        providerId: "fake",
        mode: "chat",
      }),
    );
    await page.getByTestId("rail-agents").click();
    await page.getByTestId("session-row").first().click();
    const input = page.getByTestId("composer-input");
    await input.fill("Hello from Office");
    await input.press("Enter");
    await expect(page.getByTestId("chat-assistant").last()).toContainText("Hello from Office");
  } finally {
    await app.close();
  }
});
