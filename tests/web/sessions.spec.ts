import { expect, test } from "@playwright/test";
import { launch, pick } from "./helpers";

test("a session starts with its goal", async () => {
  const { app, page } = await launch({ world: true, fakeTools: true });
  try {
    await page.getByTestId("rail-agents").click();
    await page.getByTestId("start-agent-open").click();
    await pick(page, "agent-project", { label: "Alpha" });
    await page.getByTestId("mode-provider").check();
    await pick(page, "agent-provider", { label: "Fake agent" });
    await page.getByTestId("agent-goal").fill("Tidy the sheep counter");
    await page.getByTestId("agent-start").click();
    await expect(page.getByTestId("session-goal").first()).toHaveText("Tidy the sheep counter");
  } finally {
    await app.close();
  }
});
